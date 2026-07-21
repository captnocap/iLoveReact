//! Effects — Composable pixel-buffer effect system.
//!
//! Two paths:
//!   1. Registry path (legacy): named EffectModule with create/update/draw/destroy.
//!      Used by <Spirograph />, <Rings />, etc. Kept for backward compat.
//!   2. Custom render path (new): <Effect onRender={fn}> with user-compiled callbacks.
//!      The framework provides pixel buffer + timing; user code does the math.
//!
//! Both paths share the same Instance lifecycle: CPU pixel buffer → wgpu texture → quad.
//!
//! Usage in .tsz:
//!   <Effect onRender={(e) => {
//!     for (let y = 0; y < e.height; y++)
//!       for (let x = 0; x < e.width; x++)
//!         e.setPixel(x, y, e.sin(x * 0.1 + e.time) * 0.5 + 0.5, 0, 0, 1);
//!   }} width={400} height={300} />

const std = @import("std");
const builtin = @import("builtin");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const gpu_core = @import("gpu.zig");
const images = @import("images.zig");
const log = @import("../diag/log.zig");
const layout = @import("../layout.zig");
const effect_ctx = @import("effects_ctx.zig");
const effect_shader = @import("effect_shader.zig");
const math = @import("../math/root.zig");

pub const EffectContext = effect_ctx.EffectContext;
pub const RenderFn = effect_ctx.RenderFn;
pub const GpuShaderDesc = effect_shader.GpuShaderDesc;

const Node = layout.Node;
const page_alloc = std.heap.page_allocator;

// The Effect shader assembly (header + math + recipe) lives in its own pure
// module so the V8 host and the no-V8 material path share ONE implementation.
const effect_assemble = @import("effect_assemble.zig");

// ════════════════════════════════════════════════════════════════════════
// Legacy registry interface (kept for backward compat)
// ════════════════════════════════════════════════════════════════════════

const EffectState = *anyopaque;

pub const MouseInfo = struct {
    x: f32 = 0,
    y: f32 = 0,
    dx: f32 = 0,
    dy: f32 = 0,
    speed: f32 = 0,
    inside: bool = false,
    idle: f32 = 0,
};

pub const EffectModule = struct {
    create: *const fn (w: u32, h: u32) EffectState,
    update: *const fn (state: EffectState, dt: f32, w: u32, h: u32, mouse: MouseInfo) void,
    draw: *const fn (state: EffectState, buf: []u8, w: u32, h: u32) void,
    destroy: *const fn (state: EffectState) void,
};

const MAX_EFFECT_TYPES = 32;

const RegistryEntry = struct {
    name: []const u8 = "",
    module: EffectModule = undefined,
};

var registry: [MAX_EFFECT_TYPES]RegistryEntry = [_]RegistryEntry{.{}} ** MAX_EFFECT_TYPES;
var registry_count: usize = 0;

pub fn register(name: []const u8, module: EffectModule) void {
    if (registry_count >= MAX_EFFECT_TYPES) return;
    registry[registry_count] = .{ .name = name, .module = module };
    registry_count += 1;
    log.info(.render, "Effect registered: {s}", .{name});
}

fn findModule(name: []const u8) ?*const EffectModule {
    for (registry[0..registry_count]) |*entry| {
        if (std.mem.eql(u8, entry.name, name)) return &entry.module;
    }
    return null;
}

pub fn isEffect(name: []const u8) bool {
    return findModule(name) != null;
}

// ════════════════════════════════════════════════════════════════════════
// Safety budgets — prevent runaway effects from crashing the GPU
// ════════════════════════════════════════════════════════════════════════

// Per-frame safety budgets — prevent runaway effects from saturating
// the GPU. Sized for "many small Effect instances" patterns like
// per-card animated visuals (card_stress at 2000 × 64×64 = ~8.2M
// pixels) and "single big shader rendering many cards in a tall
// grid" patterns (card_stress ONE-FX at 2000 cards × 18 cols = 112
// rows ≈ 1232×7624). Modern desktop GPUs support 8192–16384 max
// texture dim trivially; bumping past 2048 unblocks tall grids
// without per-frame downscale-and-stretch artifacts.
// Per-frame fragment budget across all on-screen effects. The hmsc-int world
// editor paints one full-resolution Effect quad per visible 120-tile chunk
// (~2880² ≈ 8.3M px each at 1:1 zoom), so the old 64M ceiling skipped every
// chunk past ~8. Effect targets are rgba8 (4 B/px), so this budget caps VRAM at
// 4×: 1.5e9 px ≈ 6 GB, ~180 full-res chunks — safe even if wgpu renders on the
// 12 GB RTX 3060 rather than the 24 GB RX 7900 XTX. Past this it's fragment FILL
// RATE (fps), not VRAM, that bites, because each chunk is ~24× oversampled
// (120×120 cells at 2880²); a per-effect resolution cap is the smooth path to
// hundreds. resolveEffectSize downscales the overflowing effect to the remaining
// budget, so g_frame_effect_pixels never exceeds this (no u32 wrap).
const MAX_EFFECT_PIXELS: u32 = 1_500_000_000; // ~6 GB of rgba8 targets / frame
const MAX_EFFECT_DIM: u32 = 8192; // no single dimension > 8192
const MAX_UPLOAD_BYTES: u32 = 32 * 1024 * 1024; // 32MB texture uploads per frame
var g_frame_effect_pixels: u32 = 0;
var g_frame_upload_bytes: u32 = 0;
var g_effect_budget_logged: bool = false;
var g_effect_debug_logged: bool = false;
var g_effect_gpu_result_logged: bool = false;
var g_effect_cpu_result_logged: bool = false;
var g_effect_queue_logged: bool = false;

// ════════════════════════════════════════════════════════════════════════
// Instances — shared between registry and custom render paths
// ════════════════════════════════════════════════════════════════════════

// Bumped from 32 → 4096 to support per-card / per-tile Effect usage
// at scale (e.g. card_stress at 2000 cards). Each Instance holds an
// Instance struct (~couple hundred bytes incl. GPU pipeline pointers
// and uniform buffer handles) — 4096 × ~256 bytes ≈ 1MB, fine.
// GPU pipelines themselves are shared across instances with the same
// shader source via `g_pipeline_cache`, so increasing the instance
// count doesn't multiply pipeline objects.
const MAX_INSTANCES = 4096;

const BackendPref = enum { auto, cpu, gpu };
const InstanceBackend = enum { cpu, gpu };

const GpuUniforms = extern struct {
    size_w: f32,
    size_h: f32,
    time: f32,
    dt: f32,
    frame: f32,
    mouse_x: f32,
    mouse_y: f32,
    mouse_inside: f32,
};

var g_paisley_debug_enabled: bool = false;

fn paisleyDebugEnabled() bool {
    return g_paisley_debug_enabled;
}

fn isPaisleyName(name: []const u8) bool {
    return std.mem.startsWith(u8, name, "paisley-");
}

fn samplePixelAlpha(buf: []const u8, width: u32, height: u32, x: u32, y: u32) u8 {
    if (width == 0 or height == 0) return 0;
    const sx = @min(width - 1, x);
    const sy = @min(height - 1, y);
    const idx: usize = @as(usize, sy) * @as(usize, width) * 4 + @as(usize, sx) * 4;
    if (idx + 3 >= buf.len) return 0;
    return buf[idx + 3];
}

fn flipRowsInPlace(buf: []u8, row_bytes: u32, h: u32) void {
    if (row_bytes == 0 or h <= 1 or row_bytes > 8192) return;

    var tmp: [8192]u8 = undefined;
    const tmp_row = tmp[0..row_bytes];
    var top: usize = 0;
    var bot: usize = h - 1;
    while (top < bot) {
        const top_ptr = buf[top * row_bytes ..][0..row_bytes];
        const bot_ptr = buf[bot * row_bytes ..][0..row_bytes];
        @memcpy(tmp_row, top_ptr);
        @memcpy(top_ptr, bot_ptr);
        @memcpy(bot_ptr, tmp_row);
        top += 1;
        bot -= 1;
    }
}

const Instance = struct {
    active: bool = false,

    // Identity — one of these is set, not both
    effect_type: []const u8 = "", // registry path
    render_fn: ?RenderFn = null, // custom render path
    render_context: ?*anyopaque = null,
    shader_desc: ?GpuShaderDesc = null, // optional GPU path for custom effects
    node_key: usize = 0, // stable identity for custom effects
    // Node-less keyed identity: a material shader materialized via
    // renderShaderToTexture (no React node drives it). node_key holds the
    // content-hash key; this flag disambiguates from pointer-derived node keys.
    is_material: bool = false,
    name: ?[]const u8 = null, // user-assigned name for referencing as fill source

    // Registry path state
    state: ?EffectState = null,
    module: ?*const EffectModule = null,

    // Pixel buffer + wgpu resources
    pixel_buf: ?[]u8 = null,
    width: u32 = 0,
    height: u32 = 0,
    texture: ?*wgpu.Texture = null,
    texture_view: ?*wgpu.TextureView = null,
    sampler: ?*wgpu.Sampler = null,
    bind_group: ?*wgpu.BindGroup = null,
    dirty: bool = false,
    backend: InstanceBackend = .cpu,
    gpu_failed: bool = false,
    gpu_pipeline: ?*wgpu.RenderPipeline = null,
    gpu_uniform_buffer: ?*wgpu.Buffer = null,
    gpu_bind_group: ?*wgpu.BindGroup = null,
    // Storage buffer at @group(0) @binding(1) — carries arbitrary cart data
    // (arrays of f32) so shader source can stay static while the data updates
    // every frame. Shader reads as `var<storage, read> data: array<f32>`. Carts
    // that don't pass `data` get a tiny placeholder buffer; the binding still
    // exists in the layout (matching every pipeline) but is unused by the
    // shader, which costs nothing.
    gpu_data_buffer: ?*wgpu.Buffer = null,
    gpu_data_capacity_floats: u32 = 0,
    gpu_data_pending: ?[]const f32 = null,
    // Hash of the WGSL source that produced the cached pipeline, so a prop
    // change to the shader string forces a recompile instead of silently
    // running the old pipeline. 0 = no pipeline yet.
    gpu_shader_hash: u64 = 0,
    // Paintable texture bindings — slice of handle strings in slot order.
    // Mirrored from node.effect_textures during paintCustomEffect; null
    // when the Effect doesn't sample any paintable texture. Hash drives
    // bind-group invalidation when the cart swaps which paintables it
    // samples.
    gpu_textures_pending: ?[]const []const u8 = null,
    gpu_textures_hash: u64 = 0,
    // Paintable-module generation counter snapshot at bind-group build
    // time. paintable.zig bumps `g_generation` every time a texture is
    // torn down (Paintable unmount, hot reload, ensure() resize). If the
    // snapshot doesn't match the live counter, the cached bind_group is
    // pointing at a destroyed view and MUST be rebuilt before the next
    // render pass — otherwise wgpu trips a validation error and the
    // process panics. 0 sentinel = no snapshot yet.
    gpu_textures_generation: u64 = 0,

    // Timing (for custom render path)
    time: f32 = 0,
    frame_count: u32 = 0,

    // Last `g_effect_frame` at which a paint call referenced this instance.
    // The sweep pass in `update(dt)` deinits + compacts slots that go more
    // than a few frames without being touched — this is what reclaims GPU
    // pipelines/textures when a cart un-mounts (cart-switch in a gallery,
    // tab picker, etc). Without this, each cart visit leaks an Instance
    // slot until MAX_INSTANCES is hit and all effects silently break.
    last_painted_frame: u32 = 0,

    // Position (for mouse hit testing)
    screen_x: f32 = 0,
    screen_y: f32 = 0,
    display_width: f32 = 0,
    display_height: f32 = 0,

    fn deinit(self: *Instance) void {
        if (self.state) |s| {
            if (self.module) |m| m.destroy(s);
        }
        self.state = null;
        if (self.bind_group) |bg| bg.release();
        if (self.sampler) |s| s.release();
        if (self.texture_view) |tv| tv.release();
        if (self.texture) |t| t.destroy();
        if (self.gpu_bind_group) |bg| bg.release();
        if (self.gpu_uniform_buffer) |buf| buf.release();
        if (self.gpu_data_buffer) |buf| buf.release();
        if (self.gpu_pipeline) |pipe| pipe.release();
        self.bind_group = null;
        self.sampler = null;
        self.texture_view = null;
        self.texture = null;
        self.gpu_bind_group = null;
        self.gpu_uniform_buffer = null;
        self.gpu_data_buffer = null;
        self.gpu_data_capacity_floats = 0;
        self.gpu_data_pending = null;
        self.gpu_pipeline = null;
        if (self.pixel_buf) |buf| page_alloc.free(buf);
        self.pixel_buf = null;
        self.active = false;
    }

    fn releaseTarget(self: *Instance) void {
        if (self.bind_group) |bg| bg.release();
        if (self.sampler) |s| s.release();
        if (self.texture_view) |tv| tv.release();
        if (self.texture) |t| t.destroy();
        self.bind_group = null;
        self.sampler = null;
        self.texture_view = null;
        self.texture = null;
    }

    fn setDisplaySize(self: *Instance, w: f32, h: f32) void {
        self.display_width = @max(1.0, w);
        self.display_height = @max(1.0, h);
    }

    fn ensureCpuSize(self: *Instance, w: u32, h: u32) void {
        if (w == 0 or h == 0) return;
        if (self.width == w and self.height == h) return;

        if (self.pixel_buf) |buf| page_alloc.free(buf);
        self.pixel_buf = page_alloc.alloc(u8, @as(usize, w) * @as(usize, h) * 4) catch return;
        @memset(self.pixel_buf.?, 0);
        self.width = w;
        self.height = h;

        self.releaseTarget();

        // Re-create registry effect state at new size
        if (self.module) |m| {
            if (self.state) |s| m.destroy(s);
            self.state = m.create(w, h);
        }
    }

    fn ensureTarget(self: *Instance, render_attachment: bool) bool {
        if (self.bind_group != null) return true;
        const device = gpu_core.getDevice() orelse return false;
        if (self.width == 0 or self.height == 0) return false;

        const tex = device.createTexture(&.{
            .label = wgpu.StringView.fromSlice("effect"),
            .size = .{ .width = self.width, .height = self.height, .depth_or_array_layers = 1 },
            .mip_level_count = 1,
            .sample_count = 1,
            .dimension = .@"2d",
            .format = .rgba8_unorm,
            // copy_src on render targets: renderShaderToPixels (the paint-bucket
            // bake) reads the rendered material back off this texture.
            .usage = if (render_attachment)
                (wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.copy_src)
            else
                (wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst),
        }) orelse return false;

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
            return false;
        };

        const sampler = device.createSampler(&.{
            .address_mode_u = .clamp_to_edge,
            .address_mode_v = .clamp_to_edge,
            .mag_filter = .linear,
            .min_filter = .linear,
        }) orelse {
            view.release();
            tex.destroy();
            return false;
        };

        const bg = images.createBindGroup(view, sampler) orelse {
            sampler.release();
            view.release();
            tex.destroy();
            return false;
        };

        self.texture = tex;
        self.texture_view = view;
        self.sampler = sampler;
        self.bind_group = bg;
        return true;
    }

    fn upload(self: *Instance) void {
        if (!self.dirty) return;
        self.dirty = false;
        const tex = self.texture orelse return;
        const buf = self.pixel_buf orelse return;
        const queue = gpu_core.getQueue() orelse return;
        const w = self.width;
        const h = self.height;
        const upload_size = @as(u32, w) * @as(u32, h) * 4;
        if (g_frame_upload_bytes + upload_size > MAX_UPLOAD_BYTES) {
            if (!g_effect_budget_logged) {
                g_effect_budget_logged = true;
                log.print("[BUDGET] Texture upload budget exceeded {d} bytes/frame — skipping upload\n", .{MAX_UPLOAD_BYTES});
            }
            return;
        }
        g_frame_upload_bytes += upload_size;
        const row_bytes = w * 4;

        // Flip rows for the shared image shader, then restore the CPU buffer so
        // CPU-side consumers like fillEffect sampling keep a stable top-down view.
        const should_flip = row_bytes <= 8192 and h > 1;
        if (should_flip) flipRowsInPlace(buf, row_bytes, h);

        queue.writeTexture(
            &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
            @ptrCast(buf.ptr),
            @as(usize, w) * @as(usize, h) * 4,
            &.{ .offset = 0, .bytes_per_row = w * 4, .rows_per_image = h },
            &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
        );

        if (should_flip) flipRowsInPlace(buf, row_bytes, h);
    }
};

const EffectSize = struct {
    width: u32,
    height: u32,
    pixels: u32,
    scaled: bool,
};

const InstanceMouseCoords = struct {
    effect_x: f32,
    effect_y: f32,
    inside: bool,
};

fn remainingEffectPixels() u32 {
    return if (g_frame_effect_pixels >= MAX_EFFECT_PIXELS) 0 else MAX_EFFECT_PIXELS - g_frame_effect_pixels;
}

fn remainingCpuEffectPixels() u32 {
    const remaining_upload_bytes = if (g_frame_upload_bytes >= MAX_UPLOAD_BYTES) 0 else MAX_UPLOAD_BYTES - g_frame_upload_bytes;
    return @min(remainingEffectPixels(), remaining_upload_bytes / 4);
}

fn resolveEffectSize(request_w: f32, request_h: f32, pixel_budget: u32) ?EffectSize {
    if (pixel_budget == 0) return null;

    const safe_w: f32 = @max(1.0, request_w);
    const safe_h: f32 = @max(1.0, request_h);
    const requested_w: u32 = @as(u32, @trunc(safe_w));
    const requested_h: u32 = @as(u32, @trunc(safe_h));
    const dim_limit: f32 = @floatFromInt(MAX_EFFECT_DIM);
    const pixel_budget_f: f32 = @floatFromInt(pixel_budget);

    var scale: f32 = 1.0;
    if (safe_w > dim_limit) scale = @min(scale, dim_limit / safe_w);
    if (safe_h > dim_limit) scale = @min(scale, dim_limit / safe_h);

    const requested_pixels = safe_w * safe_h;
    if (requested_pixels > pixel_budget_f and requested_pixels > 0) {
        scale = @min(scale, @sqrt(pixel_budget_f / requested_pixels));
    }

    var width: u32 = @min(MAX_EFFECT_DIM, @as(u32, @trunc(@max(1.0, safe_w * scale))));
    var height: u32 = @min(MAX_EFFECT_DIM, @as(u32, @trunc(@max(1.0, safe_h * scale))));
    while (@as(u64, width) * @as(u64, height) > pixel_budget) {
        if (width >= height and width > 1) {
            width -= 1;
        } else if (height > 1) {
            height -= 1;
        } else {
            break;
        }
    }

    return .{
        .width = width,
        .height = height,
        .pixels = width * height,
        .scaled = width != requested_w or height != requested_h,
    };
}

fn instanceMouseCoords(inst: *const Instance) InstanceMouseCoords {
    const draw_x = g_mouse_x - inst.screen_x;
    const draw_y = g_mouse_y - inst.screen_y;
    const draw_w = if (inst.display_width > 0) inst.display_width else @as(f32, @floatFromInt(inst.width));
    const draw_h = if (inst.display_height > 0) inst.display_height else @as(f32, @floatFromInt(inst.height));
    const inside = draw_x >= 0 and draw_x <= draw_w and draw_y >= 0 and draw_y <= draw_h;
    const scale_x = if (draw_w > 0) @as(f32, @floatFromInt(inst.width)) / draw_w else 1.0;
    const scale_y = if (draw_h > 0) @as(f32, @floatFromInt(inst.height)) / draw_h else 1.0;
    return .{
        .effect_x = draw_x * scale_x,
        .effect_y = draw_y * scale_y,
        .inside = inside,
    };
}

var instances: [MAX_INSTANCES]Instance = [_]Instance{.{}} ** MAX_INSTANCES;
var instance_count: usize = 0;
var g_backend_pref: BackendPref = .auto;
var g_gpu_bind_group_layout: ?*wgpu.BindGroupLayout = null;
// Texture-enabled variant of the bind-group layout — adds 2 texture slots
// + 2 sampler slots at bindings(2..5) so <Effect textures> can route
// paintable textures into the pipeline without per-instance layout
// proliferation. Built lazily on first use.
var g_gpu_bind_group_layout_tex: ?*wgpu.BindGroupLayout = null;
// Shared 1x1 dummy texture + sampler for unused slots in the
// textures-enabled layout. Bound when the cart's textures array is
// shorter than the layout's slot count (e.g. 1 of 2 slots in use).
var g_dummy_texture: ?*wgpu.Texture = null;
var g_dummy_texture_view: ?*wgpu.TextureView = null;
var g_dummy_sampler: ?*wgpu.Sampler = null;
/// Maximum paintable textures bound to one Effect. Sized to cutout's
/// needs (mask + gray reference). Raise if a future cart wants more.
const EFFECT_TEXTURE_SLOTS: u32 = 2;
const paintable_mod = @import("paintable.zig");

// ════════════════════════════════════════════════════════════════════════
// Mouse state (polled once per frame)
// ════════════════════════════════════════════════════════════════════════

var g_mouse_x: f32 = 0;
var g_mouse_y: f32 = 0;
var g_mouse_dx: f32 = 0;
var g_mouse_dy: f32 = 0;
var g_mouse_speed: f32 = 0;
var g_mouse_idle: f32 = 0;

pub fn pollMouse(mx: f32, my: f32, dt: f32) void {
    g_mouse_dx = mx - g_mouse_x;
    g_mouse_dy = my - g_mouse_y;
    g_mouse_speed = math.length2(g_mouse_dx, g_mouse_dy) / @max(dt, 0.001);
    if (@abs(g_mouse_dx) > 0.5 or @abs(g_mouse_dy) > 0.5) {
        g_mouse_idle = 0;
    } else {
        g_mouse_idle += dt;
    }
    g_mouse_x = mx;
    g_mouse_y = my;
}

fn instanceMouse(inst: *const Instance) MouseInfo {
    const mouse = instanceMouseCoords(inst);
    return .{
        .x = mouse.effect_x,
        .y = mouse.effect_y,
        .dx = g_mouse_dx,
        .dy = g_mouse_dy,
        .speed = g_mouse_speed,
        .inside = mouse.inside,
        .idle = g_mouse_idle,
    };
}

// ════════════════════════════════════════════════════════════════════════
// Frame timing (stored during update, used by paint)
// ════════════════════════════════════════════════════════════════════════

var g_dt: f32 = 0;

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

fn parseBackendPref(environ: *const std.process.Environ.Map) BackendPref {
    if (builtin.cpu.arch == .wasm32) return .cpu;
    const env = environ.get("ZIGOS_EFFECTS_BACKEND") orelse return .auto;
    if (std.mem.eql(u8, env, "cpu")) return .cpu;
    if (std.mem.eql(u8, env, "gpu")) return .gpu;
    return .auto;
}

fn shouldTryGpu(node: *const Node) bool {
    if (g_backend_pref == .cpu) return false;
    if (node.effect_shader == null) return false;
    if (node.effect_name != null) return false; // fillEffect still samples CPU pixels
    if (node.effect_mask) return false; // mask pipeline still CPU-only
    return true;
}

fn ensureGpuBindGroupLayout(device: *wgpu.Device) ?*wgpu.BindGroupLayout {
    if (g_gpu_bind_group_layout) |layout_ref| return layout_ref;
    // Binding 0: GpuUniforms (size, time, mouse, …) — fragment-visible.
    // Binding 1: cart-supplied f32 storage buffer for arbitrary shader data
    //   (e.g. chart series). Always present so every Effect pipeline shares
    //   one bind group layout. Shaders that don't reference binding(1) just
    //   ignore it; cost is one trivial buffer allocation per instance.
    const entries = [_]wgpu.BindGroupLayoutEntry{
        .{
            .binding = 0,
            .visibility = wgpu.ShaderStages.fragment,
            .buffer = .{
                .type = .uniform,
                .has_dynamic_offset = 0,
                .min_binding_size = @sizeOf(GpuUniforms),
            },
        },
        .{
            .binding = 1,
            .visibility = wgpu.ShaderStages.fragment,
            .buffer = .{
                .type = .read_only_storage,
                .has_dynamic_offset = 0,
                .min_binding_size = 0,
            },
        },
    };
    const layout_ref = device.createBindGroupLayout(&.{
        .entry_count = entries.len,
        .entries = &entries,
    }) orelse return null;
    g_gpu_bind_group_layout = layout_ref;
    return layout_ref;
}

/// Texture-enabled bind-group layout. Adds `EFFECT_TEXTURE_SLOTS` pairs
/// of (texture_2d, sampler) starting at binding(2). All slots are
/// fragment-visible. Shaders that don't reference a given slot pay
/// nothing at runtime; we just bind a dummy.
fn ensureGpuBindGroupLayoutTex(device: *wgpu.Device) ?*wgpu.BindGroupLayout {
    if (g_gpu_bind_group_layout_tex) |layout_ref| return layout_ref;
    var entries: [2 + EFFECT_TEXTURE_SLOTS * 2]wgpu.BindGroupLayoutEntry = undefined;
    entries[0] = .{
        .binding = 0,
        .visibility = wgpu.ShaderStages.fragment,
        .buffer = .{
            .type = .uniform,
            .has_dynamic_offset = 0,
            .min_binding_size = @sizeOf(GpuUniforms),
        },
    };
    entries[1] = .{
        .binding = 1,
        .visibility = wgpu.ShaderStages.fragment,
        .buffer = .{
            .type = .read_only_storage,
            .has_dynamic_offset = 0,
            .min_binding_size = 0,
        },
    };
    var i: u32 = 0;
    while (i < EFFECT_TEXTURE_SLOTS) : (i += 1) {
        const base: u32 = 2 + i * 2;
        entries[2 + @as(usize, i) * 2] = .{
            .binding = base,
            .visibility = wgpu.ShaderStages.fragment,
            .texture = .{
                .sample_type = .float,
                .view_dimension = .@"2d",
                .multisampled = 0,
            },
        };
        entries[3 + @as(usize, i) * 2] = .{
            .binding = base + 1,
            .visibility = wgpu.ShaderStages.fragment,
            .sampler = .{ .type = .filtering },
        };
    }
    const layout_ref = device.createBindGroupLayout(&.{
        .entry_count = entries.len,
        .entries = &entries,
    }) orelse return null;
    g_gpu_bind_group_layout_tex = layout_ref;
    return layout_ref;
}

/// Lazily build a 1x1 R8 dummy texture + sampler for unused texture
/// slots in the textures-enabled layout. WebGPU bind groups require
/// every layout-declared binding to point at SOMETHING valid; this
/// is the "valid nothing" we hand it.
fn ensureDummyTexture() bool {
    if (g_dummy_texture_view != null and g_dummy_sampler != null) return true;
    const device = gpu_core.getDevice() orelse return false;
    if (g_dummy_texture == null) {
        const tex = device.createTexture(&.{
            .label = wgpu.StringView.fromSlice("effect_dummy_tex"),
            .size = .{ .width = 1, .height = 1, .depth_or_array_layers = 1 },
            .mip_level_count = 1,
            .sample_count = 1,
            .dimension = .@"2d",
            .format = .r8_unorm,
            .usage = wgpu.TextureUsages.texture_binding,
        }) orelse return false;
        g_dummy_texture = tex;
    }
    if (g_dummy_texture_view == null) {
        const view = g_dummy_texture.?.createView(&.{
            .format = .r8_unorm,
            .dimension = .@"2d",
            .base_mip_level = 0,
            .mip_level_count = 1,
            .base_array_layer = 0,
            .array_layer_count = 1,
            .aspect = .all,
        }) orelse return false;
        g_dummy_texture_view = view;
    }
    if (g_dummy_sampler == null) {
        const samp = device.createSampler(&.{
            .address_mode_u = .clamp_to_edge,
            .address_mode_v = .clamp_to_edge,
            .mag_filter = .nearest,
            .min_filter = .nearest,
        }) orelse return false;
        g_dummy_sampler = samp;
    }
    return true;
}

/// Hash a textures slice for change detection. Same content, same
/// order → same hash; differs by either content or order → rebuild.
fn texturesHash(ids: []const []const u8) u64 {
    var hasher = std.hash.Wyhash.init(0);
    for (ids) |id| {
        hasher.update(id);
        hasher.update(&.{0}); // separator so {"a","bc"} != {"ab","c"}
    }
    return hasher.final();
}

// Process-wide pipeline cache keyed by WGSL-source hash (salted by bind-group
// layout kind). Thumbnail grids mount dozens of Effects that all carry the
// SAME shader string — the generated fill megashader is ~700KB of WGSL — and
// without this cache every mount re-ran createShaderModule's parse/validate
// (~60-90ms each), so paging a 16-thumb picker stalled 1-1.5s. The cache holds
// its own reference; instances addRef a cached pipeline and keep their existing
// release-in-deinit semantics. Entries live until cart teardown (deinit) —
// unique shader sources number in the tens, never the thousands.
var g_pipeline_cache: std.AutoHashMapUnmanaged(u64, *wgpu.RenderPipeline) = .{};

fn pipelineCacheKey(shader_hash: u64, wants_textures: bool) u64 {
    // The two bind-group layouts produce incompatible pipelines for the same
    // WGSL; salt the key so they never collide.
    return if (wants_textures) shader_hash ^ 0x9e3779b97f4a7c15 else shader_hash;
}

// Slow-compile narration (req_2692) — shared with the 3d ground pipeline.
const CompileProgress = @import("compile_progress.zig").CompileProgress;

fn getOrCreatePipeline(io: std.Io, environ: *const std.process.Environ.Map, device: *wgpu.Device, bgl: *wgpu.BindGroupLayout, wgsl: []const u8, shader_hash: u64, wants_textures: bool) ?*wgpu.RenderPipeline {
    const key = pipelineCacheKey(shader_hash, wants_textures);
    if (g_pipeline_cache.get(key)) |cached| {
        cached.addRef();
        return cached;
    }

    var progress = CompileProgress{};
    progress.start(io, environ, wgsl.len);
    defer progress.finishMemory();
    defer progress.stop();

    const module_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "effect_gpu_shader",
        .code = wgsl,
    });
    const shader_module = device.createShaderModule(&module_desc) orelse return null;
    defer shader_module.release();

    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bgl),
    }) orelse return null;
    defer pipeline_layout.release();

    const color_target = wgpu.ColorTargetState{
        .format = .rgba8_unorm,
        .blend = null,
        .write_mask = wgpu.ColorWriteMasks.all,
    };

    const fragment_state = wgpu.FragmentState{
        .module = shader_module,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };

    const pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{
            .module = shader_module,
            .entry_point = wgpu.StringView.fromSlice("vs_main"),
            .buffer_count = 0,
            .buffers = &[0]wgpu.VertexBufferLayout{},
        },
        .primitive = .{ .topology = .triangle_list },
        .multisample = .{},
        .fragment = &fragment_state,
    }) orelse return null;

    progress.finishOk();

    // One reference for the cache, one for the caller's instance. If the cache
    // can't take its entry (OOM), drop its ref — the caller's is still valid.
    pipeline.addRef();
    g_pipeline_cache.put(page_alloc, key, pipeline) catch pipeline.release();
    return pipeline;
}

fn ensureGpuPipeline(io: std.Io, environ: *const std.process.Environ.Map, self: *Instance) bool {
    const shader_desc = self.shader_desc orelse return false;

    // If the WGSL source has changed since the cached pipeline was built,
    // tear down the GPU resources so the build path below recreates them
    // against the new shader. Without this, prop swaps to a node's shader
    // string silently keep the original pipeline running.
    const new_hash = std.hash.Wyhash.hash(0, shader_desc.wgsl);
    if (self.gpu_pipeline != null and new_hash != self.gpu_shader_hash) {
        if (self.gpu_pipeline) |p| p.release();
        if (self.gpu_bind_group) |b| b.release();
        if (self.gpu_uniform_buffer) |u| u.release();
        // Keep gpu_data_buffer + capacity intact across shader-source changes —
        // the data is independent of the shader text. Only the bind group is
        // torn down (it gets rebuilt below pointing at the same data buffer).
        self.gpu_pipeline = null;
        self.gpu_bind_group = null;
        self.gpu_uniform_buffer = null;
    }

    // Detect a textures-prop shape change since last build. If the cart
    // added/removed a paintable from the array OR swapped layouts entirely
    // (from no-textures to has-textures or vice versa), the existing
    // pipeline + bind group are wrong for the new wiring and have to be
    // torn down. The hash is over the texture ID strings; bind-group
    // re-creation (without pipeline rebuild) happens later when only the
    // texture CONTENT moves but the array shape is unchanged.
    const wants_textures = self.gpu_textures_pending != null and self.gpu_textures_pending.?.len > 0;
    const new_tex_hash: u64 = if (self.gpu_textures_pending) |t| texturesHash(t) else 0;
    // Tear the bind_group down (and the pipeline along with it) on any of:
    //   - texture id array changed (different paintable handles bound)
    //   - paintable.zig generation advanced (a paintable was destroyed +
    //     possibly re-created at the same id, so our cached view points
    //     at dead memory). This catches the hot-reload race that other-
    //     wise crashes wgpu with "Texture has been destroyed".
    const live_generation = paintable_mod.generation();
    const tex_stale = wants_textures and live_generation != self.gpu_textures_generation;
    if (self.gpu_pipeline != null and (new_tex_hash != self.gpu_textures_hash or tex_stale)) {
        if (self.gpu_pipeline) |p| p.release();
        if (self.gpu_bind_group) |b| b.release();
        self.gpu_pipeline = null;
        self.gpu_bind_group = null;
    }

    if (self.gpu_pipeline != null and self.gpu_bind_group != null and self.gpu_uniform_buffer != null and self.gpu_data_buffer != null) return true;
    const device = gpu_core.getDevice() orelse return false;
    const bgl = if (wants_textures)
        (ensureGpuBindGroupLayoutTex(device) orelse return false)
    else
        (ensureGpuBindGroupLayout(device) orelse return false);
    if (wants_textures and !ensureDummyTexture()) return false;

    if (self.gpu_uniform_buffer == null) {
        self.gpu_uniform_buffer = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("effect_gpu_uniforms"),
            .size = @sizeOf(GpuUniforms),
            .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        }) orelse return false;
    }
    const uniform_buf = self.gpu_uniform_buffer.?;

    // Data buffer — sized to whatever the cart's pending data is, OR a 4-byte
    // placeholder so the binding is always valid. We can't grow this lazily
    // inside renderGpu because resizing requires recreating the bind group,
    // which is expensive — better to size it to fit at pipeline-build time.
    const initial_floats: u32 = blk: {
        if (self.gpu_data_pending) |pd| break :blk @intCast(@max(pd.len, 1));
        break :blk 1;
    };
    if (self.gpu_data_buffer == null or self.gpu_data_capacity_floats < initial_floats) {
        if (self.gpu_data_buffer) |b| b.release();
        self.gpu_data_buffer = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("effect_gpu_data"),
            .size = @as(u64, initial_floats) * @sizeOf(f32),
            .usage = wgpu.BufferUsages.storage | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        }) orelse return false;
        self.gpu_data_capacity_floats = initial_floats;
    }
    const data_buf = self.gpu_data_buffer.?;

    // Bind group entries: always binding(0) + binding(1). When the cart
    // declared textures, fill the rest of the layout's slots (each slot
    // is a texture+sampler pair). Missing entries (cart provided fewer
    // textures than EFFECT_TEXTURE_SLOTS) fall through to the dummy.
    var bind_buf: [2 + EFFECT_TEXTURE_SLOTS * 2]wgpu.BindGroupEntry = undefined;
    bind_buf[0] = .{ .binding = 0, .buffer = uniform_buf, .offset = 0, .size = @sizeOf(GpuUniforms) };
    bind_buf[1] = .{ .binding = 1, .buffer = data_buf, .offset = 0, .size = @as(u64, self.gpu_data_capacity_floats) * @sizeOf(f32) };
    var entry_count: usize = 2;
    if (wants_textures) {
        const ids = self.gpu_textures_pending.?;
        var i: u32 = 0;
        while (i < EFFECT_TEXTURE_SLOTS) : (i += 1) {
            const base: u32 = 2 + i * 2;
            const view: *wgpu.TextureView = blk: {
                if (i < ids.len) {
                    if (paintable_mod.getView(ids[i])) |v| break :blk v;
                }
                break :blk g_dummy_texture_view.?;
            };
            const samp: *wgpu.Sampler = blk: {
                if (i < ids.len) {
                    if (paintable_mod.getSampler(ids[i])) |s| break :blk s;
                }
                break :blk g_dummy_sampler.?;
            };
            bind_buf[entry_count] = .{ .binding = base, .texture_view = view };
            entry_count += 1;
            bind_buf[entry_count] = .{ .binding = base + 1, .sampler = samp };
            entry_count += 1;
        }
    }
    const effect_bg = device.createBindGroup(&.{
        .layout = bgl,
        .entry_count = @intCast(entry_count),
        .entries = &bind_buf,
    }) orelse return false;
    self.gpu_textures_hash = new_tex_hash;
    self.gpu_textures_generation = paintable_mod.generation();

    const pipeline = getOrCreatePipeline(io, environ, device, bgl, shader_desc.wgsl, new_hash, wants_textures) orelse {
        effect_bg.release();
        return false;
    };

    self.gpu_bind_group = effect_bg;
    self.gpu_pipeline = pipeline;
    self.gpu_shader_hash = new_hash;
    return true;
}

fn ensureGpuSize(self: *Instance, w: u32, h: u32) bool {
    if (w == 0 or h == 0) return false;
    if (self.width != w or self.height != h) {
        self.width = w;
        self.height = h;
        self.releaseTarget();
    }
    return self.ensureTarget(true);
}

fn renderGpu(self: *Instance) bool {
    const device = gpu_core.getDevice() orelse return false;
    const queue = gpu_core.getQueue() orelse return false;
    const pipeline = self.gpu_pipeline orelse return false;
    const effect_bg = self.gpu_bind_group orelse return false;
    const uniform_buf = self.gpu_uniform_buffer orelse return false;
    const target_view = self.texture_view orelse return false;

    const mouse = instanceMouseCoords(self);
    const uniforms = GpuUniforms{
        .size_w = @floatFromInt(self.width),
        .size_h = @floatFromInt(self.height),
        .time = self.time,
        .dt = g_dt,
        .frame = @floatFromInt(self.frame_count),
        .mouse_x = mouse.effect_x,
        .mouse_y = mouse.effect_y,
        .mouse_inside = if (mouse.inside) 1.0 else 0.0,
    };
    bu.writeValue(queue, uniform_buf, 0, &uniforms);

    // Storage-buffer upload of cart-supplied data. Uploaded only when present;
    // the cart's prop reader sets gpu_data_pending and the buffer was already
    // sized in ensureGpuPipeline. Once uploaded, clear the pending pointer so
    // we don't re-upload identical data every frame — the cart's prop reader
    // re-sets it whenever the data array reference changes.
    if (self.gpu_data_pending) |pd| {
        if (self.gpu_data_buffer) |db| {
            const upload_len = @min(pd.len, self.gpu_data_capacity_floats);
            if (upload_len > 0) {
                bu.writeTypedBuffer(queue, db, 0, f32, pd[0..upload_len]);
            }
        }
        self.gpu_data_pending = null;
    }

    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("effect_gpu") }) orelse return false;
    const pass = encoder.beginRenderPass(&.{
        .color_attachment_count = 1,
        .color_attachments = @ptrCast(&wgpu.ColorAttachment{
            .view = target_view,
            .load_op = .clear,
            .store_op = .store,
            .clear_value = .{ .r = 0, .g = 0, .b = 0, .a = 0 },
        }),
    }) orelse {
        encoder.release();
        return false;
    };
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, effect_bg, 0, null);
    pass.draw(6, 1, 0, 0);
    pass.end();
    pass.release();

    const command = encoder.finish(&.{ .label = wgpu.StringView.fromSlice("effect_gpu_cmd") }) orelse {
        encoder.release();
        return false;
    };
    encoder.release();
    queue.submit(&.{command});
    command.release();
    return true;
}

fn renderCpuNow(self: *Instance) bool {
    const render = self.render_fn orelse return false;
    const buf = self.pixel_buf orelse return false;
    if (self.width == 0 or self.height == 0) return false;
    if (buf.len < @as(usize, self.width) * @as(usize, self.height) * 4) return false;
    const mouse = instanceMouseCoords(self);
    var ctx = EffectContext{
        .buf = buf.ptr,
        .width = self.width,
        .height = self.height,
        .stride = self.width * 4,
        .time = self.time,
        .dt = g_dt,
        .mouse_x = mouse.effect_x,
        .mouse_y = mouse.effect_y,
        .mouse_inside = mouse.inside,
        .frame = self.frame_count,
        .user_data = self.node_key,
        .callback_context = self.render_context,
    };
    render(&ctx);
    self.dirty = true;
    if (self.ensureTarget(false)) {
        self.upload();
        return self.bind_group != null;
    }
    return false;
}

pub fn init(environ: *const std.process.Environ.Map) void {
    g_backend_pref = parseBackendPref(environ);
    g_paisley_debug_enabled = environ.get("ZIGOS_PAISLEY_DEBUG") != null;
}

pub fn deinit() void {
    for (instances[0..instance_count]) |*inst| inst.deinit();
    instance_count = 0;
    var pipe_it = g_pipeline_cache.valueIterator();
    while (pipe_it.next()) |pipe| pipe.*.release();
    g_pipeline_cache.deinit(page_alloc);
    g_pipeline_cache = .{};
    if (g_gpu_bind_group_layout) |layout_ref| layout_ref.release();
    g_gpu_bind_group_layout = null;
    if (g_gpu_bind_group_layout_tex) |layout_ref| layout_ref.release();
    g_gpu_bind_group_layout_tex = null;
    if (g_dummy_sampler) |s| s.release();
    if (g_dummy_texture_view) |v| v.release();
    if (g_dummy_texture) |t| t.destroy();
    g_dummy_sampler = null;
    g_dummy_texture_view = null;
    g_dummy_texture = null;
}

/// Monotonic frame counter — bumped at the start of each `update(dt)` call.
/// The sweep pass compares each Instance's `last_painted_frame` to this to
/// decide whether a slot can be reclaimed.
var g_effect_frame: u32 = 0;
/// Grace period — an Instance is kept for this many idle frames after its
/// last paint before we free it. A small buffer absorbs frames where the
/// reconciler tears down an effect briefly and re-mounts it (hot reload,
/// transitions); anything quieter than this really is dead.
const STALE_INSTANCE_GRACE: u32 = 2;

/// Deinit and drop an instance slot. Swap with the last slot so active ids
/// stay compact and instance_count shrinks.
fn dropInstance(i: usize) void {
    instances[i].deinit();
    const last = instance_count - 1;
    if (i != last) {
        instances[i] = instances[last];
        instances[last] = .{};
    } else {
        instances[i] = .{};
    }
    instance_count -= 1;
}

/// Called every frame: update registry-based effect instances and store dt.
pub fn update(dt: f32) void {
    g_dt = dt;
    g_frame_effect_pixels = 0;
    g_frame_upload_bytes = 0;
    // NOTE: g_effect_budget_logged is intentionally NOT reset here.
    // The "log once" guards across this file all check this flag, so
    // resetting it per frame meant the budget warnings spammed the
    // terminal once per frame whenever the pixel cap was approached.
    // Letting it stay true means we log only ONCE per session when a
    // budget is first exhausted — the user only needs to see it once
    // to know they need to bump MAX_EFFECT_PIXELS.

    // Reclaim slots for effects whose host nodes have unmounted. An instance
    // that was painted as recently as last frame still has
    // last_painted_frame ≈ g_effect_frame, so the `+ STALE_INSTANCE_GRACE`
    // check passes — nothing currently-visible gets collected.
    var i: usize = 0;
    while (i < instance_count) {
        const inst = &instances[i];
        // Material instances (renderShaderToTexture) are painted ONCE at load and
        // never again — their texture is BORROWED by a StaticSurface a 3D mesh
        // samples for the whole run. Reaping them on the idle sweep destroys that
        // texture out from under the bind group ("Texture 'effect' destroyed" on
        // the next render pass). They live until cart teardown (deinitAll).
        if (inst.is_material) {
            i += 1;
            continue;
        }
        const idle = g_effect_frame -% inst.last_painted_frame;
        if (idle > STALE_INSTANCE_GRACE) {
            dropInstance(i);
            // Do not advance i — the slot now holds the previously-last
            // instance, which we still need to inspect.
            continue;
        }
        i += 1;
    }

    g_effect_frame +%= 1;

    for (instances[0..instance_count]) |*inst| {
        if (!inst.active) continue;

        // Accumulate time for all instances
        inst.time += dt;
        inst.frame_count +%= 1;

        // Registry path: call module update+draw
        if (inst.module) |m| {
            const s = inst.state orelse continue;
            if (inst.width == 0 or inst.height == 0) continue;

            const mouse = instanceMouse(inst);
            m.update(s, dt, inst.width, inst.height, mouse);

            if (inst.pixel_buf) |buf| {
                m.draw(s, buf, inst.width, inst.height);
                inst.dirty = true;
            }
        }

        // Custom render path: skip here — rendering + upload happens in
        // paintCustomEffect → renderCpuNow during the paint phase.
        // Doing it here too causes a use-after-destroy: update() writes to
        // the texture, then paintCustomEffect() destroys it on resize,
        // and the buffered writeTexture hits a dead texture at queue.submit().
        if (inst.render_fn != null) continue;

        // Upload to GPU (registry path only)
        if (inst.dirty) {
            if (inst.ensureTarget(false)) inst.upload();
        }
    }
}

/// Paint a registry-based effect (node has effect_type string).
pub fn paintEffect(effect_type: []const u8, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    var inst = findInstanceByType(effect_type);
    if (inst == null) {
        inst = createRegistryInstance(effect_type);
    }
    const i = inst orelse return false;
    i.active = true;
    i.last_painted_frame = g_effect_frame;
    i.screen_x = x;
    i.screen_y = y;
    i.setDisplaySize(w, h);
    i.backend = .cpu;

    const resolved = resolveEffectSize(w, h, remainingCpuEffectPixels()) orelse {
        if (!g_effect_budget_logged) {
            g_effect_budget_logged = true;
            log.print("[BUDGET] Effect budget exhausted — skipping effect\n", .{});
        }
        return false;
    };
    g_frame_effect_pixels += resolved.pixels;
    i.ensureCpuSize(resolved.width, resolved.height);

    const bg = i.bind_group orelse return false;
    if (i.width == 0 or i.height == 0) return false;

    log.info(.render, "effect cpu type={s} rect=({d:.0},{d:.0},{d:.0},{d:.0}) tex={d}x{d}", .{
        effect_type, x, y, w, h, i.width, i.height,
    });
    images.queueQuad(x, y, w, h, opacity, bg);
    return true;
}

/// Paint a custom effect (node has effect_render and optional effect_shader).
/// GPU is used when a shader-safe lowering exists; otherwise this falls back to CPU.
pub fn paintCustomEffect(io: std.Io, environ: *const std.process.Environ.Map, node: *const Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    var inst = findInstanceByNode(node);
    if (inst == null) {
        inst = createCustomInstance(node);
    }
    const i = inst orelse return false;
    i.render_context = node.effect_render_context;
    i.active = true;
    i.last_painted_frame = g_effect_frame;
    i.screen_x = x;
    i.screen_y = y;
    i.setDisplaySize(w, h);
    // React may swap the node's shader prop; refresh so ensureGpuPipeline
    // sees the live WGSL and rebuilds when the source hash changes.
    i.shader_desc = node.effect_shader;
    // Cart-supplied storage-buffer data (Float32Array). Stash the slice; the
    // upload happens in renderGpu after ensureGpuPipeline has guaranteed the
    // buffer + bind group exist. If the cart's data array grew past the
    // current GPU buffer's capacity, release the buffer + bind group so
    // ensureGpuPipeline rebuilds them at the new size — the bind group
    // entry's `size` field is fixed at creation.
    i.gpu_data_pending = node.effect_data;
    // Mirror the cart's texture-binding declaration into the instance so
    // ensureGpuPipeline knows whether to use the textures-enabled bind
    // group layout this frame. Hash diff drives bind-group rebuild
    // (paintable swap) but pipeline rebuild only happens when the layout
    // choice itself toggles — which texturesHash differing reliably
    // signals (length 0 → non-zero or array shape change).
    i.gpu_textures_pending = node.effect_textures;
    if (node.effect_data) |pd| {
        if (pd.len > i.gpu_data_capacity_floats) {
            if (i.gpu_data_buffer) |b| b.release();
            if (i.gpu_bind_group) |bg| bg.release();
            i.gpu_data_buffer = null;
            i.gpu_bind_group = null;
            i.gpu_data_capacity_floats = 0;
        }
    }
    const node_name = node.debug_name orelse "?";
    log.info(.render, "custom effect node={s} ptr=0x{x} rect=({d:.0},{d:.0},{d:.0},{d:.0}) gpu_try={} gpu_failed={} shader={} background={}", .{
        node_name, @intFromPtr(node), x, y, w, h, shouldTryGpu(node), i.gpu_failed, node.effect_shader != null, node.effect_background,
    });

    if (!g_effect_debug_logged) {
        g_effect_debug_logged = true;
        log.print("[effect-paint] node={x} rect=({d:.0},{d:.0},{d:.0},{d:.0}) shouldTryGpu={} shader_set={}\n", .{ @intFromPtr(node), x, y, w, h, shouldTryGpu(node), node.effect_shader != null });
    }
    if (shouldTryGpu(node) and !i.gpu_failed) {
        const resolved = resolveEffectSize(w, h, remainingEffectPixels()) orelse {
            if (!g_effect_budget_logged) {
                g_effect_budget_logged = true;
                log.print("[BUDGET] Effect pixel budget exhausted — skipping effect\n", .{});
            }
            return false;
        };
        g_frame_effect_pixels += resolved.pixels;
        i.backend = .gpu;
        const size_ok = ensureGpuSize(i, resolved.width, resolved.height);
        const pipe_ok = size_ok and ensureGpuPipeline(io, environ, i);
        const render_ok = pipe_ok and renderGpu(i);
        if (!g_effect_gpu_result_logged) {
            g_effect_gpu_result_logged = true;
            log.print("[effect-gpu] size_ok={} pipe_ok={} render_ok={}\n", .{ size_ok, pipe_ok, render_ok });
        }
        log.info(.render, "custom effect gpu node={s} size_ok={} pipe_ok={} render_ok={} tex={d}x{d} bind_group={} target={} pipeline={}", .{
            node_name,
            size_ok,
            pipe_ok,
            render_ok,
            i.width,
            i.height,
            i.bind_group != null,
            i.texture_view != null,
            i.gpu_pipeline != null,
        });
        if (size_ok and pipe_ok and render_ok) {
            const bg = i.bind_group orelse return false;
            images.queueQuad(x, y, w, h, opacity, bg);
            log.info(.render, "custom effect gpu queued node={s}", .{node_name});
            return true;
        }
        g_frame_effect_pixels -= resolved.pixels;
        log.warn(.render, "custom effect gpu failed node={s} -> cpu fallback", .{node_name});
        i.gpu_failed = true;
    }

    const resolved = resolveEffectSize(w, h, remainingCpuEffectPixels()) orelse {
        if (!g_effect_budget_logged) {
            g_effect_budget_logged = true;
            log.print("[BUDGET] Effect budget exhausted — skipping effect\n", .{});
        }
        return false;
    };
    g_frame_effect_pixels += resolved.pixels;
    i.backend = .cpu;
    i.ensureCpuSize(resolved.width, resolved.height);
    if (i.width == 0 or i.height == 0) {
        log.warn(.render, "custom effect cpu zero-sized node={s}", .{node_name});
        return false;
    }
    const cpu_ok = renderCpuNow(i);
    if (!g_effect_cpu_result_logged) {
        g_effect_cpu_result_logged = true;
        log.print("[effect-cpu] render_ok={} tex={d}x{d} bind_group={} pixel_buf={}\n", .{ cpu_ok, i.width, i.height, i.bind_group != null, i.pixel_buf != null });
    }
    if (!cpu_ok) {
        return false;
    }
    const bg = i.bind_group orelse return false;

    images.queueQuad(x, y, w, h, opacity, bg);
    if (!g_effect_queue_logged) {
        g_effect_queue_logged = true;
        log.print("[effect-queued] backend={s} tex={d}x{d}\n", .{ @tagName(i.backend), i.width, i.height });
    }
    return true;
}

/// Paint a background effect for a parent node (registry path).
pub fn paintBackground(effect_type: []const u8, px: f32, py: f32, pw: f32, ph: f32, opacity: f32) bool {
    var inst = findInstanceByType(effect_type);
    if (inst == null) {
        inst = createRegistryInstance(effect_type);
    }
    const i = inst orelse return false;
    i.active = true;
    i.last_painted_frame = g_effect_frame;
    i.screen_x = px;
    i.screen_y = py;
    i.setDisplaySize(pw, ph);
    i.backend = .cpu;

    const resolved = resolveEffectSize(pw, ph, remainingCpuEffectPixels()) orelse {
        if (!g_effect_budget_logged) {
            g_effect_budget_logged = true;
            log.print("[BUDGET] Effect budget exhausted — skipping background effect\n", .{});
        }
        return false;
    };
    g_frame_effect_pixels += resolved.pixels;
    i.ensureCpuSize(resolved.width, resolved.height);

    const bg = i.bind_group orelse return false;
    if (i.width == 0 or i.height == 0) return false;

    images.queueQuad(px, py, pw, ph, opacity, bg);
    return true;
}

// ════════════════════════════════════════════════════════════════════════
// Instance management
// ════════════════════════════════════════════════════════════════════════

fn findInstanceByType(effect_type: []const u8) ?*Instance {
    for (instances[0..instance_count]) |*inst| {
        if (inst.active and inst.module != null and std.mem.eql(u8, inst.effect_type, effect_type))
            return inst;
    }
    return null;
}

/// Stable identity for an effect node. `scroll_persist_slot` carries the
/// React fiber id through every tree rebuild (set by the host's ensureNode
/// path); fall back to the arena pointer for non-QJS hosts (LuaJIT cart
/// runtime) that don't populate it. Keying Instances by the React id stops
/// cart switches from re-binding a new shader's uniforms onto the previous
/// cart's pipeline just because the arena reused the same address.
fn instanceKey(node: *const Node) usize {
    return if (node.scroll_persist_slot != 0) @as(usize, node.scroll_persist_slot) else @intFromPtr(node);
}

fn findInstanceByNode(node: *const Node) ?*Instance {
    const key = instanceKey(node);
    for (instances[0..instance_count]) |*inst| {
        if (inst.active and inst.node_key == key and inst.render_fn != null)
            return inst;
    }
    return null;
}

fn createRegistryInstance(effect_type: []const u8) ?*Instance {
    if (instance_count >= MAX_INSTANCES) return null;
    const m = findModule(effect_type) orelse return null;

    const inst = &instances[instance_count];
    inst.* = .{
        .active = true,
        .effect_type = effect_type,
        .module = m,
        .last_painted_frame = g_effect_frame,
    };
    instance_count += 1;
    return inst;
}

fn createCustomInstance(node: *const Node) ?*Instance {
    if (instance_count >= MAX_INSTANCES) return null;
    const render_fn = node.effect_render orelse return null;

    const inst = &instances[instance_count];
    inst.* = .{
        .active = true,
        .render_fn = render_fn,
        .render_context = node.effect_render_context,
        .shader_desc = node.effect_shader,
        .node_key = instanceKey(node),
        .last_painted_frame = g_effect_frame,
    };
    instance_count += 1;
    return inst;
}

/// Get-or-create the node-less instance for a materialized shader, keyed by a
/// content hash (no React node drives it).
fn ensureMaterialInstance(key_hash: u64) ?*Instance {
    const nk: usize = @intCast(key_hash);
    var i: usize = 0;
    while (i < instance_count) : (i += 1) {
        if (instances[i].is_material and instances[i].node_key == nk) return &instances[i];
    }
    if (instance_count >= MAX_INSTANCES) return null;
    const inst = &instances[instance_count];
    inst.* = .{ .active = true, .is_material = true, .node_key = nk };
    instance_count += 1;
    return inst;
}

/// Materialize a SHADER (raw WGSL + `data[]` storage params) into a GPU texture
/// STANDALONE — outside the paint loop, callable at load. Reuses the custom-
/// effect GPU path (compile → size → render); `renderGpu` owns its command
/// encoder so no frame is required. Returns the rendered texture's view (effects
/// retains ownership, cached by `key_hash` for the host's lifetime). The shared
/// shader→texture primitive (gpu/material_tex.zig) wraps this with the surface
/// install so 3D faces sample it via scene3d_tex_key.
pub fn renderShaderToTexture(io: std.Io, environ: *const std.process.Environ.Map, key_hash: u64, wgsl: []const u8, data: ?[]const f32, size: u32) ?*wgpu.TextureView {
    const inst = ensureMaterialInstance(key_hash) orelse return null;
    // The shipped recipe is the fragment body; assemble it with the SAME fixed
    // header + math prelude the V8 host injects (U/VsOut/vs_main/fbm/…), so the
    // material shader compiles identically here. Freed after the pipeline
    // compiles it (createShaderModule copies the source; renderGpu draws from the
    // cached pipeline, not shader_desc).
    const full = effect_assemble.assemble(page_alloc, wgsl) orelse return null;
    defer page_alloc.free(full);
    inst.active = true;
    inst.backend = .gpu;
    inst.last_painted_frame = g_effect_frame;
    inst.shader_desc = .{ .wgsl = full };
    inst.gpu_data_pending = data;
    inst.setDisplaySize(@floatFromInt(size), @floatFromInt(size));
    const ok = ensureGpuSize(inst, size, size) and ensureGpuPipeline(io, environ, inst) and renderGpu(inst);
    inst.shader_desc = null; // `full` is freed on return; the pipeline is already built
    if (!ok) return null;
    return inst.texture_view;
}

/// Materialize a shader and read the rendered pixels back to CPU RGBA — the
/// paint-bucket half of the material door. Returns gpu.readbackTexture's
/// layout ([w: u32 LE][h: u32 LE][tight RGBA]); caller frees. The static-
/// surface registry canNOT do this readback: materialize installs a BORROWED
/// view there, and readbackStaticSurface rejects borrowed entries — the
/// instance's own texture is the only readable handle.
pub fn renderShaderToPixels(io: std.Io, environ: *const std.process.Environ.Map, key_hash: u64, wgsl: []const u8, data: ?[]const f32, size: u32) ?[]u8 {
    if (renderShaderToTexture(io, environ, key_hash, wgsl, data, size) == null) return null;
    const inst = ensureMaterialInstance(key_hash) orelse return null;
    const tex = inst.texture orelse return null;
    // Effect targets are created rgba8_unorm (ensureTarget) — no BGRA swizzle.
    return gpu_core.readbackTexture(tex, inst.width, inst.height, false);
}

fn findInstanceByName(effect_name: []const u8) ?*Instance {
    for (instances[0..instance_count]) |*inst| {
        if (inst.active and inst.name != null and std.mem.eql(u8, inst.name.?, effect_name))
            return inst;
    }
    return null;
}

/// Named effect info for use as polygon fill source.
pub const EffectFillInfo = struct {
    bind_group: *wgpu.BindGroup,
    pixel_buf: [*]const u8,
    width: u32,
    height: u32,
    screen_x: f32,
    screen_y: f32,
};

/// Look up a named effect for use as a fill texture source.
pub fn getEffectFill(effect_name: []const u8) ?EffectFillInfo {
    const inst = findInstanceByName(effect_name) orelse return null;
    const bg = inst.bind_group orelse return null;
    const buf = inst.pixel_buf orelse return null;
    if (inst.width == 0 or inst.height == 0) return null;
    if (paisleyDebugEnabled() and isPaisleyName(effect_name)) {
        const cx = if (inst.width > 0) inst.width / 2 else 0;
        const cy = if (inst.height > 0) inst.height / 2 else 0;
        const center_a = samplePixelAlpha(buf, inst.width, inst.height, cx, cy);
        log.print(
            "[paisley] getEffectFill name={s} size={d}x{d} center_a={d} screen=({d:.1},{d:.1})\n",
            .{ effect_name, inst.width, inst.height, center_a, inst.screen_x, inst.screen_y },
        );
    }
    return .{
        .bind_group = bg,
        .pixel_buf = buf.ptr,
        .width = inst.width,
        .height = inst.height,
        .screen_x = inst.screen_x,
        .screen_y = inst.screen_y,
    };
}

/// Paint a named custom effect — same as paintCustomEffect but stores the name
/// for later lookup by Graph.Path fillEffect references. Does NOT draw an image
/// quad — the effect is invisible until referenced by a fill.
pub fn paintNamedEffect(node: *const Node, effect_name: []const u8, x: f32, y: f32, w: f32, h: f32) bool {
    var inst = findInstanceByNode(node);
    if (inst == null) {
        inst = createCustomInstance(node);
    }
    const i = inst orelse return false;
    i.render_context = node.effect_render_context;
    i.active = true;
    i.last_painted_frame = g_effect_frame;
    i.backend = .cpu;
    i.name = effect_name;
    i.screen_x = x;
    i.screen_y = y;
    i.setDisplaySize(w, h);

    const resolved = resolveEffectSize(w, h, remainingCpuEffectPixels()) orelse {
        if (!g_effect_budget_logged) {
            g_effect_budget_logged = true;
            log.print("[BUDGET] Effect budget exhausted — skipping named effect\n", .{});
        }
        return false;
    };
    g_frame_effect_pixels += resolved.pixels;
    i.ensureCpuSize(resolved.width, resolved.height);

    if (i.width == 0 or i.height == 0) return false;
    const ok = renderCpuNow(i);
    if (paisleyDebugEnabled() and isPaisleyName(effect_name)) {
        var center_a: u8 = 0;
        var quarter_a: u8 = 0;
        if (i.pixel_buf) |buf| {
            center_a = samplePixelAlpha(buf, i.width, i.height, i.width / 2, i.height / 2);
            quarter_a = samplePixelAlpha(buf, i.width, i.height, i.width / 4, i.height / 4);
        }
        log.print(
            "[paisley] paintNamedEffect name={s} node={x} box=({d:.1},{d:.1},{d:.1},{d:.1}) tex={d}x{d} ok={} center_a={d} quarter_a={d}\n",
            .{ effect_name, @intFromPtr(node), x, y, w, h, i.width, i.height, ok, center_a, quarter_a },
        );
    }
    if (!ok) return false;
    // Don't draw — the effect is only drawn when referenced by a polygon fill
    return true;
}
