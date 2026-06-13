//! Paintable mask textures — persistent GPU textures with shader-side painting.
//!
//! A "paintable" is a stable string-handle-keyed `wgpu.Texture` (R8Unorm,
//! one byte per pixel) at fixed image resolution. Carts paint into it via
//! enqueued ops; other shaders sample it as a read-only `texture_2d<f32>`
//! input.
//!
//! Per-frame flow:
//!   1. JS submits brush ops (paintCircle / paintPolygon / clear / upload)
//!      via V8 bindings. Each call queues onto the named paintable.
//!   2. `drainAll()` runs once per frame before any Effect draws. It walks
//!      every paintable with pending ops and runs them through a single
//!      brush render-pass per paintable.
//!   3. Other Effects sample the paintable through the `textures` prop
//!      (wired in effects.zig). The texture view returned by `getView()`
//!      lives in a bind group entry on the consuming Effect's pipeline.
//!
//! Readback is async: `requestReadback(id)` queues a copy-to-buffer +
//! mapAsync, completes with a CPU `Uint8Array` once the GPU finishes.
//!
//! Brush rendering: the brush pipeline uses a 6-vertex triangle-list
//! quad whose corners are emitted from a tiny per-op uniform (bbox in
//! mask NDC). The fragment shader computes stamp coverage for round,
//! soft, square, flat, chisel, filbert, rake/fan, dry, spray, and knife
//! brush shapes. Polygon lasso still uses the CPU fallback below.

const std = @import("std");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const gpu_core = @import("gpu.zig");
const log = @import("../diag/log.zig");

const page_alloc = std.heap.page_allocator;

const MAX_PAINTABLES: usize = 64;
const MAX_OPS_PER_FRAME: usize = 4096;
const MAX_POLY_VERTS: usize = 256;

/// Op kind tag.
const OpKind = enum(u8) {
    clear,
    circle,
    circle_edge,
    brush,
    polygon,
    upload,
};

/// One enqueued brush op. Variants are pulled by `kind`.
const Op = struct {
    kind: OpKind = .clear,
    // circle / circle_edge
    cx: f32 = 0,
    cy: f32 = 0,
    r: f32 = 0,
    value: f32 = 0,
    brush_kind: f32 = 0,
    angle: f32 = 0,
    aspect: f32 = 1,
    hardness: f32 = 1,
    flow: f32 = 1,
    scatter: f32 = 0,
    seed: f32 = 0,
    // circle_edge: id of the gray reference paintable + sobel threshold
    gray_id_hash: u64 = 0,
    grad_threshold: f32 = 0,
    // polygon
    poly_off: u32 = 0, // offset into Paintable.poly_pool
    poly_count: u32 = 0,
    // upload
    upload_bytes: ?[]u8 = null, // owned; freed after submit
};

/// One paintable texture entry.
const Paintable = struct {
    active: bool = false,
    /// Stable user-supplied handle (e.g. "cutout/mask-A"). Owned heap copy.
    key: []u8 = &.{},
    key_hash: u64 = 0,
    width: u32 = 0,
    height: u32 = 0,

    texture: ?*wgpu.Texture = null,
    view: ?*wgpu.TextureView = null,
    sampler: ?*wgpu.Sampler = null,

    /// FIFO op queue. Drained once per frame.
    ops: [MAX_OPS_PER_FRAME]Op = [_]Op{.{}} ** MAX_OPS_PER_FRAME,
    op_count: usize = 0,

    /// Backing storage for polygon vertex coordinates referenced by Op.poly_off.
    /// Cleared at the same time as op_count.
    poly_pool: [MAX_POLY_VERTS * 4]f32 = [_]f32{0} ** (MAX_POLY_VERTS * 4),
    poly_used: u32 = 0,

    /// True when the texture has been written to since the last drain.
    /// Consumers can check this to know whether to re-render.
    dirty: bool = false,
};

// ─── Module state ────────────────────────────────────────────────────────
var g_entries: [MAX_PAINTABLES]Paintable = [_]Paintable{.{}} ** MAX_PAINTABLES;
/// Monotonic generation counter — bumps every time a paintable's
/// underlying wgpu texture is destroyed (releaseEntry). Consumers like
/// effects.zig cache the value at bind-group-build time and rebuild when
/// it advances, so a render pass never references a destroyed view.
/// Without this, hot reload or any Paintable unmount mid-frame trips
/// "Texture with 'paintable' label has been destroyed" in wgpu.
var g_generation: u64 = 0;
var g_brush_pipeline: ?*wgpu.RenderPipeline = null;
var g_brush_bgl: ?*wgpu.BindGroupLayout = null;
var g_brush_uniform_buf: ?*wgpu.Buffer = null;
var g_brush_bind_group: ?*wgpu.BindGroup = null;
var g_sampler_default: ?*wgpu.Sampler = null;

/// Per-draw uniforms for the brush pass. Matches WGSL struct BU below.
const BrushUniforms = extern struct {
    tex_w: f32,
    tex_h: f32,
    cx: f32,
    cy: f32,
    radius: f32,
    value: f32,
    kind: f32,
    angle: f32,
    aspect: f32,
    hardness: f32,
    flow: f32,
    scatter: f32,
    seed: f32,
    pad0: f32 = 0,
    pad1: f32 = 0,
    pad2: f32 = 0,
};

const BRUSH_WGSL =
    \\struct BU {
    \\  tex_w: f32, tex_h: f32,
    \\  cx: f32, cy: f32,
    \\  radius: f32, value: f32,
    \\  kind: f32, angle: f32,
    \\  aspect: f32, hardness: f32,
    \\  flow: f32, scatter: f32,
    \\  seed: f32,
    \\  pad0: f32, pad1: f32, pad2: f32,
    \\};
    \\@group(0) @binding(0) var<uniform> U: BU;
    \\
    \\struct VsOut { @builtin(position) pos: vec4f, @location(0) world: vec2f };
    \\
    \\fn sat(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }
    \\fn hash12(p: vec2f) -> f32 {
    \\  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
    \\}
    \\fn edge_coverage(dist: f32, hardness: f32) -> f32 {
    \\  let feather = max(0.002, (1.0 - sat(hardness)) * 0.55 + 0.002);
    \\  return 1.0 - smoothstep(1.0 - feather, 1.0, dist);
    \\}
    \\
    \\@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    \\  // Six vertices forming a quad covering the brush bbox in pixel space.
    \\  let r = U.radius * (max(max(U.aspect, 1.0), 1.0) + max(U.scatter, 0.0)) + 3.0;
    \\  let x0 = U.cx - r;
    \\  let x1 = U.cx + r;
    \\  let y0 = U.cy - r;
    \\  let y1 = U.cy + r;
    \\  var corner: vec2f;
    \\  switch (vi) {
    \\    case 0u: { corner = vec2f(x0, y0); }
    \\    case 1u: { corner = vec2f(x1, y0); }
    \\    case 2u: { corner = vec2f(x0, y1); }
    \\    case 3u: { corner = vec2f(x1, y0); }
    \\    case 4u: { corner = vec2f(x1, y1); }
    \\    default:  { corner = vec2f(x0, y1); }
    \\  }
    \\  // Map pixel (x,y) into NDC (-1..1). Y flips because wgpu has y-down NDC.
    \\  let nx = (corner.x / U.tex_w) * 2.0 - 1.0;
    \\  let ny = 1.0 - (corner.y / U.tex_h) * 2.0;
    \\  var out: VsOut;
    \\  out.pos = vec4f(nx, ny, 0.0, 1.0);
    \\  out.world = corner;
    \\  return out;
    \\}
    \\
    \\@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
    \\  let dx = in.world.x - U.cx;
    \\  let dy = in.world.y - U.cy;
    \\  let ca = cos(U.angle);
    \\  let sa = sin(U.angle);
    \\  let p = vec2f(dx * ca + dy * sa, -dx * sa + dy * ca);
    \\  let r = max(U.radius, 0.001);
    \\  let aspect = max(U.aspect, 0.05);
    \\  let kind = floor(U.kind + 0.5);
    \\  var coverage = 0.0;
    \\
    \\  if (kind == 1.0) {
    \\    let d = length(p) / r;
    \\    coverage = pow(sat(1.0 - d), mix(0.55, 3.0, sat(U.hardness)));
    \\  } else if (kind == 2.0) {
    \\    let d = max(abs(p.x) / (r * aspect), abs(p.y) / r);
    \\    coverage = edge_coverage(d, U.hardness);
    \\  } else if (kind == 3.0) {
    \\    let d = max(abs(p.x) / (r * max(aspect, 1.6)), abs(p.y) / (r * 0.42));
    \\    coverage = edge_coverage(d, U.hardness);
    \\  } else if (kind == 4.0) {
    \\    let skew = p.x + p.y * 0.55;
    \\    let d = max(abs(skew) / (r * max(aspect, 1.5)), abs(p.y) / (r * 0.46));
    \\    coverage = edge_coverage(d, U.hardness);
    \\  } else if (kind == 5.0) {
    \\    let q = vec2f(p.x / (r * max(aspect, 1.15)), p.y / (r * 0.62));
    \\    coverage = edge_coverage(length(q), U.hardness);
    \\  } else if (kind == 6.0) {
    \\    let q = vec2f(p.x / (r * max(aspect, 1.3)), p.y / r);
    \\    let base = edge_coverage(length(q), U.hardness);
    \\    let teeth = 7.0;
    \\    let cell = fract((q.x * 0.5 + 0.5) * teeth);
    \\    coverage = base * step(cell, 0.48);
    \\  } else if (kind == 7.0) {
    \\    let q = vec2f(p.x / (r * max(aspect, 1.8)), (p.y + r * 0.18) / r);
    \\    let width = mix(0.42, 1.08, sat((q.y + 0.95) / 1.9));
    \\    let base = (1.0 - smoothstep(width - 0.08, width, abs(q.x))) * (1.0 - smoothstep(0.86, 1.0, abs(q.y)));
    \\    let teeth = 9.0;
    \\    let cell = fract((q.x * 0.5 + 0.5) * teeth);
    \\    coverage = base * mix(0.24, 1.0, step(cell, 0.42));
    \\  } else if (kind == 8.0) {
    \\    let q = vec2f(p.x / (r * max(aspect, 1.2)), p.y / r);
    \\    let base = edge_coverage(length(q), U.hardness);
    \\    let n = hash12(floor(in.world.xy * 0.65 + vec2f(U.seed, U.seed * 1.7)));
    \\    let grain = step(0.36 + sat(U.scatter) * 0.28, n);
    \\    coverage = base * grain;
    \\  } else if (kind == 9.0) {
    \\    let q = p / (r * (1.0 + max(U.scatter, 0.0)));
    \\    let d = length(q);
    \\    let n = hash12(floor(in.world.xy * 0.9 + vec2f(U.seed * 3.1, U.seed * 1.3)));
    \\    let density = mix(0.78, 0.38, sat(U.flow));
    \\    coverage = (1.0 - smoothstep(0.75, 1.0, d)) * step(density, n);
    \\  } else if (kind == 10.0) {
    \\    let skew = p.x + p.y * 0.22;
    \\    let d = max(abs(skew) / (r * max(aspect, 2.8)), abs(p.y) / (r * 0.22));
    \\    coverage = edge_coverage(d, U.hardness);
    \\  } else {
    \\    let d = length(p) / r;
    \\    coverage = edge_coverage(d, U.hardness);
    \\  }
    \\
    \\  coverage = sat(coverage) * sat(U.flow);
    \\  if (coverage <= 0.001) { discard; }
    \\  return vec4f(U.value * coverage, 0.0, 0.0, coverage);
    \\}
    ;

// ─── Init / teardown ──────────────────────────────────────────────────────

pub fn init() void {
    // Lazy — pipelines and global resources created on first use.
}

pub fn deinit() void {
    for (&g_entries) |*e| {
        releaseEntry(e);
    }
    for (&g_parked_uploads) |*p| {
        if (p.active) releaseParked(p);
    }
    if (g_brush_pipeline) |p| p.release();
    if (g_brush_bgl) |b| b.release();
    if (g_brush_uniform_buf) |b| b.release();
    if (g_brush_bind_group) |b| b.release();
    if (g_sampler_default) |s| s.release();
    g_brush_pipeline = null;
    g_brush_bgl = null;
    g_brush_uniform_buf = null;
    g_brush_bind_group = null;
    g_sampler_default = null;
}

fn releaseEntry(e: *Paintable) void {
    if (e.texture != null or e.view != null or e.sampler != null) {
        // Bump the generation BEFORE freeing — any consumer that read
        // the previous generation and cached a bind-group is now stale
        // and will recompute on its next render.
        g_generation += 1;
    }
    if (e.sampler) |s| s.release();
    if (e.view) |v| v.release();
    if (e.texture) |t| t.destroy();
    if (e.key.len > 0) page_alloc.free(e.key);
    // Free any still-pending upload bytes.
    var i: usize = 0;
    while (i < e.op_count) : (i += 1) {
        if (e.ops[i].upload_bytes) |b| page_alloc.free(b);
    }
    e.* = .{};
}

/// Monotonic counter, advanced on every paintable teardown. Effects.zig
/// reads this to detect a stale cached bind group and rebuild it before
/// the next render pass binds a destroyed texture view.
pub fn generation() u64 {
    return g_generation;
}

// ─── Handle lookup / creation ────────────────────────────────────────────

fn hashKey(key: []const u8) u64 {
    return std.hash.Wyhash.hash(0, key);
}

fn findEntry(key: []const u8) ?*Paintable {
    const h = hashKey(key);
    for (&g_entries) |*e| {
        if (e.active and e.key_hash == h and std.mem.eql(u8, e.key, key)) return e;
    }
    return null;
}

fn findOrCreateEntry(key: []const u8, w: u32, h: u32) ?*Paintable {
    if (findEntry(key)) |existing| {
        if (existing.width != w or existing.height != h) {
            // Re-allocate texture at new size. Op queue is discarded —
            // resize is treated as "fresh paintable".
            releaseEntry(existing);
        } else {
            return existing;
        }
    }
    // Find a free slot.
    for (&g_entries) |*e| {
        if (e.active) continue;
        const key_copy = page_alloc.alloc(u8, key.len) catch return null;
        @memcpy(key_copy, key);
        e.* = .{
            .active = true,
            .key = key_copy,
            .key_hash = hashKey(key),
            .width = w,
            .height = h,
        };
        if (!ensureTexture(e)) {
            releaseEntry(e);
            return null;
        }
        flushParkedUpload(e);
        return e;
    }
    log.print("[paintable] no free slot (max={d})\n", .{MAX_PAINTABLES});
    return null;
}

// ─── Parked uploads (PAINTLIVE-0606: the cold-boot restore race) ─────────
// The reconciler's CREATE commands drain at the START OF THE NEXT FRAME
// (__hostFlush queues), but __paintable_upload executes immediately — so a
// document restore's mask upload can arrive BEFORE its <Paintable> entry
// exists. Dropping it silently blanked restored paintings at cold boot
// (and the autosave then snapshotted the blank GPU back over the draft).
// Park such uploads by key and flush them the moment ensure() creates the
// entry. Uploads only: brush/circle ops are user input, which cannot
// precede the surface existing on screen.

const MAX_PARKED_UPLOADS = 64;
const ParkedUpload = struct {
    key: []u8 = &.{},
    bytes: []u8 = &.{},
    active: bool = false,
};
var g_parked_uploads: [MAX_PARKED_UPLOADS]ParkedUpload = [_]ParkedUpload{.{}} ** MAX_PARKED_UPLOADS;

fn releaseParked(p: *ParkedUpload) void {
    if (p.key.len > 0) page_alloc.free(p.key);
    if (p.bytes.len > 0) page_alloc.free(p.bytes);
    p.* = .{};
}

fn parkUpload(key: []const u8, bytes: []const u8) void {
    // Last write wins per key — exactly the semantics of a live upload.
    var slot: ?*ParkedUpload = null;
    for (&g_parked_uploads) |*p| {
        if (p.active and std.mem.eql(u8, p.key, key)) {
            releaseParked(p);
            slot = p;
            break;
        }
        if (slot == null and !p.active) slot = p;
    }
    const p = slot orelse {
        log.print("[paintable] parked-upload table full (max={d}) — dropping {s}\n", .{ MAX_PARKED_UPLOADS, key });
        return;
    };
    const key_copy = page_alloc.alloc(u8, key.len) catch return;
    @memcpy(key_copy, key);
    const bytes_copy = page_alloc.alloc(u8, bytes.len) catch {
        page_alloc.free(key_copy);
        return;
    };
    @memcpy(bytes_copy, bytes);
    p.* = .{ .key = key_copy, .bytes = bytes_copy, .active = true };
}

fn flushParkedUpload(e: *Paintable) void {
    for (&g_parked_uploads) |*p| {
        if (!p.active or !std.mem.eql(u8, p.key, e.key)) continue;
        if (p.bytes.len == @as(usize, e.width) * @as(usize, e.height)) {
            // Ownership of bytes moves to the op (drainEntry frees them).
            pushOp(e, .{ .kind = .upload, .upload_bytes = p.bytes });
            page_alloc.free(p.key);
            p.* = .{};
        } else {
            log.print("[paintable] parked upload size mismatch for {s}: got {d}, want {d}*{d}\n", .{ e.key, p.bytes.len, e.width, e.height });
            releaseParked(p);
        }
        return;
    }
}

fn ensureTexture(e: *Paintable) bool {
    if (e.texture != null) return true;
    const device = gpu_core.getDevice() orelse return false;
    if (e.width == 0 or e.height == 0) return false;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("paintable"),
        .size = .{ .width = e.width, .height = e.height, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .r8_unorm,
        .usage = wgpu.TextureUsages.texture_binding |
            wgpu.TextureUsages.render_attachment |
            wgpu.TextureUsages.copy_src |
            wgpu.TextureUsages.copy_dst,
    }) orelse return false;
    const view = tex.createView(&.{
        .format = .r8_unorm,
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
        .mag_filter = .nearest,
        .min_filter = .nearest,
    }) orelse {
        view.release();
        tex.destroy();
        return false;
    };
    e.texture = tex;
    e.view = view;
    e.sampler = sampler;
    // Initial clear to zero — the device guarantees zero-initialized
    // resources by default, but make it explicit for clarity.
    e.dirty = true;
    return true;
}

// ─── Brush pipeline ──────────────────────────────────────────────────────

fn ensureBrushPipeline() bool {
    if (g_brush_pipeline != null) return true;
    const device = gpu_core.getDevice() orelse return false;

    const bgl_entries = [_]wgpu.BindGroupLayoutEntry{
        .{
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
            .buffer = .{
                .type = .uniform,
                .has_dynamic_offset = 0,
                .min_binding_size = @sizeOf(BrushUniforms),
            },
        },
    };
    const bgl = device.createBindGroupLayout(&.{
        .entry_count = bgl_entries.len,
        .entries = &bgl_entries,
    }) orelse return false;
    g_brush_bgl = bgl;

    const uniform_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("paintable_brush_uniforms"),
        .size = @sizeOf(BrushUniforms),
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    }) orelse return false;
    g_brush_uniform_buf = uniform_buf;

    const bind_entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .buffer = uniform_buf, .offset = 0, .size = @sizeOf(BrushUniforms) },
    };
    const bg = device.createBindGroup(&.{
        .layout = bgl,
        .entry_count = bind_entries.len,
        .entries = &bind_entries,
    }) orelse return false;
    g_brush_bind_group = bg;

    const module_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "paintable_brush",
        .code = BRUSH_WGSL,
    });
    const shader = device.createShaderModule(&module_desc) orelse return false;
    defer shader.release();

    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bgl),
    }) orelse return false;
    defer pipeline_layout.release();

    const blend_state = wgpu.BlendState.premultiplied_alpha_blending;
    const color_target = wgpu.ColorTargetState{
        .format = .r8_unorm,
        .blend = &blend_state,
        .write_mask = wgpu.ColorWriteMasks.all,
    };
    const fragment_state = wgpu.FragmentState{
        .module = shader,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };
    const pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{
            .module = shader,
            .entry_point = wgpu.StringView.fromSlice("vs_main"),
            .buffer_count = 0,
            .buffers = &[0]wgpu.VertexBufferLayout{},
        },
        .primitive = .{ .topology = .triangle_list },
        .multisample = .{},
        .fragment = &fragment_state,
    }) orelse return false;
    g_brush_pipeline = pipeline;
    return true;
}

// ─── Public API: declarative create / lookup ─────────────────────────────

/// Get-or-create a paintable. Called from the Native primitive on mount /
/// resize. Returns null on failure (no GPU device, no free slot).
pub fn ensure(key: []const u8, w: u32, h: u32) bool {
    if (key.len == 0 or w == 0 or h == 0) return false;
    return findOrCreateEntry(key, w, h) != null;
}

/// Look up the read-only texture view for use as a binding on another
/// Effect's pipeline. Returns null if the paintable doesn't exist yet.
pub fn getView(key: []const u8) ?*wgpu.TextureView {
    const e = findEntry(key) orelse return null;
    return e.view;
}

pub fn getDimensions(key: []const u8) ?struct { w: u32, h: u32 } {
    const e = findEntry(key) orelse return null;
    return .{ .w = e.width, .h = e.height };
}

/// Remove a paintable. Called when the Native primitive unmounts.
pub fn destroy(key: []const u8) void {
    if (findEntry(key)) |e| releaseEntry(e);
}

// ─── Public API: enqueue ops ─────────────────────────────────────────────

pub fn queueClear(key: []const u8, value: f32) void {
    const e = findEntry(key) orelse return;
    pushOp(e, .{ .kind = .clear, .value = value });
}

pub fn queueCircle(key: []const u8, cx: f32, cy: f32, r: f32, value: f32) void {
    const e = findEntry(key) orelse return;
    pushOp(e, .{ .kind = .circle, .cx = cx, .cy = cy, .r = r, .value = value, .flow = 1, .hardness = 1, .aspect = 1 });
}

pub fn queueCircleEdgeAware(
    key: []const u8,
    cx: f32,
    cy: f32,
    r: f32,
    value: f32,
    gray_key: []const u8,
    grad_threshold: f32,
) void {
    const e = findEntry(key) orelse return;
    pushOp(e, .{
        .kind = .circle_edge,
        .cx = cx,
        .cy = cy,
        .r = r,
        .value = value,
        .flow = 1,
        .hardness = 1,
        .aspect = 1,
        .gray_id_hash = hashKey(gray_key),
        .grad_threshold = grad_threshold,
    });
}

pub fn queueBrush(
    key: []const u8,
    cx: f32,
    cy: f32,
    r: f32,
    value: f32,
    kind: f32,
    angle: f32,
    aspect: f32,
    hardness: f32,
    flow: f32,
    scatter: f32,
    seed: f32,
) void {
    const e = findEntry(key) orelse return;
    pushOp(e, .{
        .kind = .brush,
        .cx = cx,
        .cy = cy,
        .r = r,
        .value = value,
        .brush_kind = kind,
        .angle = angle,
        .aspect = @max(0.05, aspect),
        .hardness = std.math.clamp(hardness, 0.0, 1.0),
        .flow = std.math.clamp(flow, 0.0, 1.0),
        .scatter = @max(0.0, scatter),
        .seed = seed,
    });
}

pub fn queuePolygon(key: []const u8, verts: []const f32, value: f32) void {
    const e = findEntry(key) orelse return;
    // verts is interleaved x0,y0,x1,y1,...
    if (verts.len < 6) return; // need at least 3 points
    const need = verts.len;
    if (e.poly_used + need > e.poly_pool.len) return;
    const off = e.poly_used;
    @memcpy(e.poly_pool[off .. off + need], verts);
    e.poly_used += @intCast(need);
    pushOp(e, .{
        .kind = .polygon,
        .value = value,
        .poly_off = off,
        .poly_count = @intCast(verts.len / 2),
    });
}

/// Upload raw R8 bytes into the paintable, replacing whatever's there.
/// Used by backend results (SAM, flood-fill) that produce CPU masks.
/// `bytes` is copied into a queued op; the queue drain frees it.
pub fn queueUpload(key: []const u8, bytes: []const u8) void {
    const e = findEntry(key) orelse {
        // The entry's CREATE is still in the reconciler queue (it drains
        // next frame) — park the bytes; ensure() flushes them on creation.
        parkUpload(key, bytes);
        return;
    };
    if (bytes.len != @as(usize, e.width) * @as(usize, e.height)) {
        log.print("[paintable] upload size mismatch: got {d}, want {d}*{d}\n", .{ bytes.len, e.width, e.height });
        return;
    }
    const copy = page_alloc.alloc(u8, bytes.len) catch return;
    @memcpy(copy, bytes);
    pushOp(e, .{ .kind = .upload, .upload_bytes = copy });
}

fn pushOp(e: *Paintable, op: Op) void {
    if (e.op_count >= MAX_OPS_PER_FRAME) {
        // Drop the new op; logging once-per-frame would be nice but we'd
        // need a guard. Best-effort behavior is fine here — brush burst
        // > 4096 ops/frame is already pathological.
        return;
    }
    e.ops[e.op_count] = op;
    e.op_count += 1;
}

// ─── Drain ───────────────────────────────────────────────────────────────

/// Run all queued ops on all paintables through one render-pass each.
/// Called once per frame, BEFORE any Effect that samples a paintable
/// draws (so the consumed texture sees the latest writes).
pub fn drainAll() void {
    var any: bool = false;
    for (g_entries[0..]) |*e| {
        if (e.active and e.op_count > 0) { any = true; break; }
    }
    if (!any) return;
    if (!ensureBrushPipeline()) return;

    for (&g_entries) |*e| {
        if (!e.active or e.op_count == 0) continue;
        drainEntry(e);
    }
}

fn drainEntry(e: *Paintable) void {
    const device = gpu_core.getDevice() orelse return;
    const queue = gpu_core.getQueue() orelse return;
    const target = e.view orelse return;
    const pipeline = g_brush_pipeline orelse return;
    const bg = g_brush_bind_group orelse return;
    const uniform_buf = g_brush_uniform_buf orelse return;

    const op_count = e.op_count;
    var i: usize = 0;
    while (i < op_count) : (i += 1) {
        const op = e.ops[i];
        switch (op.kind) {
            .clear => {
                // Submit a render pass that just clears to op.value (in R8Unorm,
                // value 0..1 maps directly).
                const encoder = device.createCommandEncoder(&.{
                    .label = wgpu.StringView.fromSlice("paintable_clear"),
                }) orelse continue;
                const pass = encoder.beginRenderPass(&.{
                    .color_attachment_count = 1,
                    .color_attachments = @ptrCast(&wgpu.ColorAttachment{
                        .view = target,
                        .load_op = .clear,
                        .store_op = .store,
                        .clear_value = .{ .r = op.value, .g = 0, .b = 0, .a = 1 },
                    }),
                }) orelse {
                    encoder.release();
                    continue;
                };
                pass.end();
                pass.release();
                const cmd = encoder.finish(&.{
                    .label = wgpu.StringView.fromSlice("paintable_clear_cmd"),
                }) orelse {
                    encoder.release();
                    continue;
                };
                encoder.release();
                queue.submit(&.{cmd});
                cmd.release();
                e.dirty = true;
            },
            .circle, .circle_edge, .brush => {
                // Edge-aware mode is treated identically here for now; the
                // brush WGSL doesn't sample gray. The sobel rejection lives
                // in a follow-up pipeline variant (see TODO). The op survives
                // round-trip so when that lands no callsite churn is needed.
                const u = BrushUniforms{
                    .tex_w = @floatFromInt(e.width),
                    .tex_h = @floatFromInt(e.height),
                    .cx = op.cx,
                    .cy = op.cy,
                    .radius = op.r,
                    .value = op.value,
                    .kind = if (op.kind == .brush) op.brush_kind else 0.0,
                    .angle = op.angle,
                    .aspect = op.aspect,
                    .hardness = op.hardness,
                    .flow = op.flow,
                    .scatter = op.scatter,
                    .seed = op.seed,
                    .pad0 = 0,
                    .pad1 = 0,
                    .pad2 = 0,
                };
                bu.writeValue(queue, uniform_buf, 0, &u);

                const encoder = device.createCommandEncoder(&.{
                    .label = wgpu.StringView.fromSlice("paintable_brush"),
                }) orelse continue;
                const pass = encoder.beginRenderPass(&.{
                    .color_attachment_count = 1,
                    .color_attachments = @ptrCast(&wgpu.ColorAttachment{
                        .view = target,
                        // Load preserves existing texture contents — critical so
                        // each stroke dab adds to what's already painted.
                        .load_op = .load,
                        .store_op = .store,
                        .clear_value = .{ .r = 0, .g = 0, .b = 0, .a = 0 },
                    }),
                }) orelse {
                    encoder.release();
                    continue;
                };
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bg, 0, null);
                pass.draw(6, 1, 0, 0);
                pass.end();
                pass.release();
                const cmd = encoder.finish(&.{
                    .label = wgpu.StringView.fromSlice("paintable_brush_cmd"),
                }) orelse {
                    encoder.release();
                    continue;
                };
                encoder.release();
                queue.submit(&.{cmd});
                cmd.release();
                e.dirty = true;
            },
            .polygon => {
                // Polygon fill: not yet implemented in shader. Falls back to
                // CPU rasterize + writeTexture so the API works end-to-end
                // even though the GPU path is the followup. Polygon fills
                // are rare (lasso tool) so the CPU path is fine for now.
                rasterizePolygonCpu(e, op);
                e.dirty = true;
            },
            .upload => {
                if (op.upload_bytes) |bytes| {
                    uploadBytes(e, bytes);
                    page_alloc.free(bytes);
                    e.dirty = true;
                }
            },
        }
    }
    e.op_count = 0;
    e.poly_used = 0;
}

fn uploadBytes(e: *Paintable, bytes: []const u8) void {
    const queue = gpu_core.getQueue() orelse return;
    const tex = e.texture orelse return;
    if (bytes.len != @as(usize, e.width) * @as(usize, e.height)) return;
    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        @ptrCast(bytes.ptr),
        bytes.len,
        &.{ .offset = 0, .bytes_per_row = e.width, .rows_per_image = e.height },
        &.{ .width = e.width, .height = e.height, .depth_or_array_layers = 1 },
    );
}

/// CPU rasterize a polygon into a temporary buffer, then writeTexture into
/// the paintable. Scanline fill, even-odd rule. Used until the GPU polygon
/// pipeline lands — lasso tool uses this path.
fn rasterizePolygonCpu(e: *Paintable, op: Op) void {
    const queue = gpu_core.getQueue() orelse return;
    const tex = e.texture orelse return;
    if (op.poly_count < 3) return;

    const w = e.width;
    const h = e.height;
    const verts = e.poly_pool[op.poly_off .. op.poly_off + op.poly_count * 2];

    // Compute bbox for a smaller writeTexture region.
    var yMinF: f32 = std.math.floatMax(f32);
    var yMaxF: f32 = -std.math.floatMax(f32);
    var xMinF: f32 = std.math.floatMax(f32);
    var xMaxF: f32 = -std.math.floatMax(f32);
    var pi: usize = 0;
    while (pi < op.poly_count) : (pi += 1) {
        const x = verts[pi * 2];
        const y = verts[pi * 2 + 1];
        if (x < xMinF) xMinF = x;
        if (x > xMaxF) xMaxF = x;
        if (y < yMinF) yMinF = y;
        if (y > yMaxF) yMaxF = y;
    }
    const xMin: i32 = @max(0, @as(i32, @intFromFloat(@floor(xMinF))));
    const xMax: i32 = @min(@as(i32, @intCast(w)) - 1, @as(i32, @intFromFloat(@ceil(xMaxF))));
    const yMin: i32 = @max(0, @as(i32, @intFromFloat(@floor(yMinF))));
    const yMax: i32 = @min(@as(i32, @intCast(h)) - 1, @as(i32, @intFromFloat(@ceil(yMaxF))));
    if (xMax < xMin or yMax < yMin) return;

    // We need the EXISTING pixels for the bbox region first so we can write
    // back unchanged pixels around the polygon. Easiest correct path: rasterize
    // a same-size buffer for the bbox, then writeTexture just the polygon's
    // bbox. Polygon op REPLACES inside the polygon; outside the polygon is
    // not touched.
    //
    // To do that without a GPU readback, we use a separate render-pass-based
    // path… but to keep the CPU fallback simple, we treat polygons as
    // OVERWRITE-INSIDE: pixels OUTSIDE the polygon inside the bbox are
    // currently re-zeroed. That's a known bug pinned in the polygon followup.
    // Lasso isn't shipping yet for this checkpoint.

    const bw: u32 = @intCast(xMax - xMin + 1);
    const bh: u32 = @intCast(yMax - yMin + 1);
    const buf = page_alloc.alloc(u8, @as(usize, bw) * @as(usize, bh)) catch return;
    defer page_alloc.free(buf);
    @memset(buf, 0);

    var y: i32 = yMin;
    while (y <= yMax) : (y += 1) {
        const fy: f32 = @floatFromInt(y);
        // Collect x-intersections with each edge.
        var inters: [MAX_POLY_VERTS]f32 = undefined;
        var nInters: usize = 0;
        var i: usize = 0;
        while (i < op.poly_count) : (i += 1) {
            const j = (i + 1) % op.poly_count;
            const yi = verts[i * 2 + 1];
            const yj = verts[j * 2 + 1];
            if ((yi <= fy and yj > fy) or (yj <= fy and yi > fy)) {
                const t = (fy - yi) / (yj - yi);
                const x = verts[i * 2] + t * (verts[j * 2] - verts[i * 2]);
                if (nInters < inters.len) {
                    inters[nInters] = x;
                    nInters += 1;
                }
            }
        }
        // Sort intersections.
        std.mem.sort(f32, inters[0..nInters], {}, std.sort.asc(f32));
        var k: usize = 0;
        while (k + 1 < nInters) : (k += 2) {
            const x0i: i32 = @max(xMin, @as(i32, @intFromFloat(@floor(inters[k]))));
            const x1i: i32 = @min(xMax, @as(i32, @intFromFloat(@ceil(inters[k + 1]))));
            const row_start: usize = @as(usize, @intCast(y - yMin)) * bw;
            var xx: i32 = x0i;
            while (xx <= x1i) : (xx += 1) {
                const bx: usize = @as(usize, @intCast(xx - xMin));
                const px_val: u8 = @intFromFloat(std.math.clamp(op.value * 255.0, 0.0, 255.0));
                buf[row_start + bx] = px_val;
            }
        }
    }

    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{
            .x = @intCast(xMin), .y = @intCast(yMin), .z = 0,
        }, .aspect = .all },
        @ptrCast(buf.ptr),
        buf.len,
        &.{ .offset = 0, .bytes_per_row = bw, .rows_per_image = bh },
        &.{ .width = bw, .height = bh, .depth_or_array_layers = 1 },
    );
}

// ─── Readback ────────────────────────────────────────────────────────────
//
// Carts call `requestReadback(key)` from JS, which enqueues a copy +
// mapAsync. The result is delivered via a small polling shim on the JS
// side (the V8 binding stashes pending readbacks and resolves them when
// the framework calls back into JS once the GPU finishes).
//
// For Checkpoint 1 we only implement the SYNCHRONOUS-on-demand variant
// used by save/export, which submits a copy + a synchronous device.poll
// + map. That's fine for "once per save" timing. The async pump can come
// later if any real-time consumer needs it.

/// Synchronous readback. Caller frees the returned bytes via the same
/// allocator. Returns null on failure. Blocks until the GPU finishes the
/// copy + map. ONLY call at save / export points.
pub fn readbackSync(key: []const u8) ?[]u8 {
    const e = findEntry(key) orelse return null;
    // Drain any pending ops so the readback reflects the latest writes.
    if (e.op_count > 0) {
        if (ensureBrushPipeline()) drainEntry(e);
    }
    const device = gpu_core.getDevice() orelse return null;
    const queue = gpu_core.getQueue() orelse return null;
    const tex = e.texture orelse return null;
    const w = e.width;
    const h = e.height;

    // wgpu requires bytes_per_row to be 256-byte aligned on most backends.
    const ALIGN: u32 = 256;
    const padded_row: u32 = ((w + ALIGN - 1) / ALIGN) * ALIGN;
    const total: usize = @as(usize, padded_row) * @as(usize, h);

    const buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("paintable_readback"),
        .size = total,
        .usage = wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.map_read,
        .mapped_at_creation = 0,
    }) orelse return null;
    defer buf.release();

    const encoder = device.createCommandEncoder(&.{
        .label = wgpu.StringView.fromSlice("paintable_readback_cmd"),
    }) orelse return null;
    encoder.copyTextureToBuffer(
        &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        &.{ .buffer = buf, .layout = .{
            .offset = 0,
            .bytes_per_row = padded_row,
            .rows_per_image = h,
        } },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
    const cmd = encoder.finish(&.{
        .label = wgpu.StringView.fromSlice("paintable_readback_finish"),
    }) orelse {
        encoder.release();
        return null;
    };
    encoder.release();
    queue.submit(&.{cmd});
    cmd.release();

    // Map + poll until done. The buffer's `mapAsync` is async; we spin
    // device.poll() until the map callback fires. This is acceptable here
    // since readback is rare (save / export paths).
    var done: bool = false;
    const cb_struct = struct {
        fn cb(status: wgpu.MapAsyncStatus, _: wgpu.StringView, userdata1: ?*anyopaque, _: ?*anyopaque) callconv(.c) void {
            _ = status;
            const done_ptr: *bool = @ptrCast(@alignCast(userdata1.?));
            done_ptr.* = true;
        }
    };
    _ = buf.mapAsync(
        wgpu.MapModes.read,
        0,
        total,
        .{
            .callback = cb_struct.cb,
            .userdata1 = @ptrCast(&done),
        },
    );
    while (!done) {
        _ = device.poll(true, null);
    }

    const mapped_ptr = buf.getConstMappedRange(0, total) orelse return null;
    const out = page_alloc.alloc(u8, @as(usize, w) * @as(usize, h)) catch {
        buf.unmap();
        return null;
    };
    // Strip row padding back to tight (w bytes per row).
    var row: u32 = 0;
    while (row < h) : (row += 1) {
        const src_off: usize = @as(usize, row) * @as(usize, padded_row);
        const dst_off: usize = @as(usize, row) * @as(usize, w);
        const mapped_slice = @as([*]const u8, @ptrCast(mapped_ptr));
        @memcpy(out[dst_off .. dst_off + w], mapped_slice[src_off .. src_off + w]);
    }
    buf.unmap();
    return out;
}

// ─── Sampler accessor (for cross-Effect binding) ────────────────────────

pub fn getSampler(key: []const u8) ?*wgpu.Sampler {
    const e = findEntry(key) orelse return null;
    return e.sampler;
}
