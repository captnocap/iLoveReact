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
const math = @import("../math.zig");
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

// ════════════════════════════════════════════════════════════════════════
// Procedural geometry
// ════════════════════════════════════════════════════════════════════════

// Two distinct caps:
//   MAX_MESH_VERTS — CPU staging buffer for *one* generateGeometry call.
//                    Each mesh's verts are built into g_geo_buf starting at
//                    index 0; this caps a single mesh's tessellation.
//   MAX_FRAME_VERTS — GPU vertex buffer total across all meshes drawn in
//                    one Scene3D render pass. Each drawMesh appends at a
//                    cumulative byte offset, so draws don't read each
//                    other's bytes.
const MAX_MESH_VERTS = 4096;
const MAX_FRAME_VERTS = 65536;
var g_geo_buf: [MAX_MESH_VERTS]Vertex = undefined;

const UNIFORM_STRIDE: u32 = 256;
const MAX_DRAW_UNIFORMS: u32 = 512;

fn pushVertex(buf: []Vertex, idx: *usize, pos: [3]f32, normal: [3]f32, uv: [2]f32) bool {
    if (idx.* >= buf.len) return false;
    buf[idx.*] = .{
        .px = pos[0],
        .py = pos[1],
        .pz = pos[2],
        .nx = normal[0],
        .ny = normal[1],
        .nz = normal[2],
        .u = uv[0],
        .v = uv[1],
    };
    idx.* += 1;
    return true;
}

fn addTri(buf: []Vertex, idx: *usize, a: [3]f32, na: [3]f32, uva: [2]f32, b: [3]f32, nb: [3]f32, uvb: [2]f32, c: [3]f32, nc: [3]f32, uvc: [2]f32) bool {
    return pushVertex(buf, idx, a, na, uva) and
        pushVertex(buf, idx, b, nb, uvb) and
        pushVertex(buf, idx, c, nc, uvc);
}

fn addTriFlat(buf: []Vertex, idx: *usize, a: [3]f32, b: [3]f32, c: [3]f32, n: [3]f32) bool {
    return addTri(buf, idx, a, n, .{ 0, 0 }, b, n, .{ 1, 0 }, c, n, .{ 1, 1 });
}

fn addFace(buf: []Vertex, idx: *usize, v1: [3]f32, v2: [3]f32, v3: [3]f32, v4: [3]f32, n: [3]f32) void {
    const corners = [4][3]f32{ v1, v2, v3, v4 };
    const uvs = [4][2]f32{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
    const tri = [6]u8{ 0, 1, 2, 0, 2, 3 };
    for (tri) |ti| {
        _ = pushVertex(buf, idx, corners[ti], n, uvs[ti]);
    }
}

fn toArr(v: math.Vec3) [3]f32 {
    return .{ v.x, v.y, v.z };
}

fn normal3(x: f32, y: f32, z: f32) [3]f32 {
    return toArr(math.v3normalize(.{ .x = x, .y = y, .z = z }));
}

fn generateBox(sx: f32, sy: f32, sz: f32) struct { count: u32 } {
    const hx = sx * 0.5;
    const hy = sy * 0.5;
    const hz = sz * 0.5;
    var idx: usize = 0;
    addFace(&g_geo_buf, &idx, .{ -hx, -hy, hz }, .{ hx, -hy, hz }, .{ hx, hy, hz }, .{ -hx, hy, hz }, .{ 0, 0, 1 }); // front
    addFace(&g_geo_buf, &idx, .{ hx, -hy, -hz }, .{ -hx, -hy, -hz }, .{ -hx, hy, -hz }, .{ hx, hy, -hz }, .{ 0, 0, -1 }); // back
    addFace(&g_geo_buf, &idx, .{ hx, -hy, hz }, .{ hx, -hy, -hz }, .{ hx, hy, -hz }, .{ hx, hy, hz }, .{ 1, 0, 0 }); // right
    addFace(&g_geo_buf, &idx, .{ -hx, -hy, -hz }, .{ -hx, -hy, hz }, .{ -hx, hy, hz }, .{ -hx, hy, -hz }, .{ -1, 0, 0 }); // left
    addFace(&g_geo_buf, &idx, .{ -hx, hy, hz }, .{ hx, hy, hz }, .{ hx, hy, -hz }, .{ -hx, hy, -hz }, .{ 0, 1, 0 }); // top
    addFace(&g_geo_buf, &idx, .{ -hx, -hy, -hz }, .{ hx, -hy, -hz }, .{ hx, -hy, hz }, .{ -hx, -hy, hz }, .{ 0, -1, 0 }); // bottom
    return .{ .count = @intCast(idx) };
}

fn generateSphere(radius: f32, segments: u32, rings: u32) struct { count: u32 } {
    var idx: usize = 0;
    const pi = std.math.pi;
    var i: u32 = 0;
    while (i < rings) : (i += 1) {
        const t1 = pi * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(rings));
        const t2 = pi * @as(f32, @floatFromInt(i + 1)) / @as(f32, @floatFromInt(rings));
        var j: u32 = 0;
        while (j < segments) : (j += 1) {
            const p1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
            const p2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
            const pt = struct {
                fn f(r: f32, theta: f32, phi: f32) [3]f32 {
                    const st = @sin(theta);
                    return .{ r * st * @cos(phi), r * @cos(theta), r * st * @sin(phi) };
                }
                fn n(theta: f32, phi: f32) [3]f32 {
                    const st = @sin(theta);
                    return .{ st * @cos(phi), @cos(theta), st * @sin(phi) };
                }
            };
            const a = pt.f(radius, t1, p1);
            const b = pt.f(radius, t1, p2);
            const c = pt.f(radius, t2, p2);
            const d = pt.f(radius, t2, p1);
            const na = pt.n(t1, p1);
            const nb = pt.n(t1, p2);
            const nc = pt.n(t2, p2);
            const nd = pt.n(t2, p1);
            // Planar UV projection onto the +Z hemisphere — `u = (nx+1)/2`,
            // `v = (1-ny)/2`. A texture stamped through this mapping behaves
            // like a flat decal stuck to the front of the sphere; the back
            // hemisphere mirrors the front, but back faces are culled and
            // when visible (e.g. orbiting around) the camera reads the
            // same image from the rear. Good enough for a face-on-head
            // moonshot — no longitude/latitude squashing near the poles.
            const ua: f32 = (na[0] + 1.0) * 0.5;
            const va: f32 = (1.0 - na[1]) * 0.5;
            const ub: f32 = (nb[0] + 1.0) * 0.5;
            const vb: f32 = (1.0 - nb[1]) * 0.5;
            const uc: f32 = (nc[0] + 1.0) * 0.5;
            const vc: f32 = (1.0 - nc[1]) * 0.5;
            const ud: f32 = (nd[0] + 1.0) * 0.5;
            const vd: f32 = (1.0 - nd[1]) * 0.5;
            if (idx + 6 > MAX_MESH_VERTS) return .{ .count = @intCast(idx) };
            // Triangle 1: a, d, c
            g_geo_buf[idx] = .{ .px = a[0], .py = a[1], .pz = a[2], .nx = na[0], .ny = na[1], .nz = na[2], .u = ua, .v = va };
            idx += 1;
            g_geo_buf[idx] = .{ .px = d[0], .py = d[1], .pz = d[2], .nx = nd[0], .ny = nd[1], .nz = nd[2], .u = ud, .v = vd };
            idx += 1;
            g_geo_buf[idx] = .{ .px = c[0], .py = c[1], .pz = c[2], .nx = nc[0], .ny = nc[1], .nz = nc[2], .u = uc, .v = vc };
            idx += 1;
            // Triangle 2: a, c, b
            g_geo_buf[idx] = .{ .px = a[0], .py = a[1], .pz = a[2], .nx = na[0], .ny = na[1], .nz = na[2], .u = ua, .v = va };
            idx += 1;
            g_geo_buf[idx] = .{ .px = c[0], .py = c[1], .pz = c[2], .nx = nc[0], .ny = nc[1], .nz = nc[2], .u = uc, .v = vc };
            idx += 1;
            g_geo_buf[idx] = .{ .px = b[0], .py = b[1], .pz = b[2], .nx = nb[0], .ny = nb[1], .nz = nb[2], .u = ub, .v = vb };
            idx += 1;
        }
    }
    return .{ .count = @intCast(idx) };
}

fn generatePlane(sx: f32, sz: f32) struct { count: u32 } {
    const hx = sx * 0.5;
    const hz = sz * 0.5;
    var idx: usize = 0;
    addFace(&g_geo_buf, &idx, .{ -hx, 0, -hz }, .{ hx, 0, -hz }, .{ hx, 0, hz }, .{ -hx, 0, hz }, .{ 0, 1, 0 });
    return .{ .count = @intCast(idx) };
}

fn generateCylinder(radius: f32, height: f32, segments: u32) struct { count: u32 } {
    var idx: usize = 0;
    const pi = std.math.pi;
    const hy = height * 0.5;
    var j: u32 = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const c1 = @cos(a1);
        const s1 = @sin(a1);
        const c2 = @cos(a2);
        const s2 = @sin(a2);
        const a = .{ radius * c1, -hy, radius * s1 };
        const b = .{ radius * c2, -hy, radius * s2 };
        const c = .{ radius * c2, hy, radius * s2 };
        const d = .{ radius * c1, hy, radius * s1 };
        const n1 = .{ c1, 0, s1 };
        const n2 = .{ c2, 0, s2 };
        if (!addTri(&g_geo_buf, &idx, a, n1, .{ 0, 0 }, d, n1, .{ 0, 1 }, c, n2, .{ 1, 1 })) break;
        if (!addTri(&g_geo_buf, &idx, a, n1, .{ 0, 0 }, c, n2, .{ 1, 1 }, b, n2, .{ 1, 0 })) break;
        if (!addTriFlat(&g_geo_buf, &idx, .{ 0, hy, 0 }, b, a, .{ 0, 1, 0 })) break;
        if (!addTriFlat(&g_geo_buf, &idx, .{ 0, -hy, 0 }, a, b, .{ 0, -1, 0 })) break;
    }
    return .{ .count = @intCast(idx) };
}

fn generateCone(radius: f32, height: f32, segments: u32) struct { count: u32 } {
    var idx: usize = 0;
    const pi = std.math.pi;
    const hy = height * 0.5;
    const slope = if (@abs(height) > 0.001) radius / height else 1.0;
    const apex = [3]f32{ 0, hy, 0 };
    var j: u32 = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const mid = (a1 + a2) * 0.5;
        const c1 = @cos(a1);
        const s1 = @sin(a1);
        const c2 = @cos(a2);
        const s2 = @sin(a2);
        const a = .{ radius * c1, -hy, radius * s1 };
        const b = .{ radius * c2, -hy, radius * s2 };
        const n1 = normal3(c1, slope, s1);
        const n2 = normal3(c2, slope, s2);
        const na = normal3(@cos(mid), slope, @sin(mid));
        if (!addTri(&g_geo_buf, &idx, a, n1, .{ 0, 0 }, apex, na, .{ 0.5, 1 }, b, n2, .{ 1, 0 })) break;
        if (!addTriFlat(&g_geo_buf, &idx, .{ 0, -hy, 0 }, a, b, .{ 0, -1, 0 })) break;
    }
    return .{ .count = @intCast(idx) };
}

fn generateTorus(radius: f32, tube_radius: f32, segments: u32, sides: u32) struct { count: u32 } {
    var idx: usize = 0;
    const pi = std.math.pi;
    const torus = struct {
        fn pos(r: f32, tr: f32, u: f32, v: f32) [3]f32 {
            const ring = r + tr * @cos(v);
            return .{ ring * @cos(u), tr * @sin(v), ring * @sin(u) };
        }
        fn normal(u: f32, v: f32) [3]f32 {
            return .{ @cos(u) * @cos(v), @sin(v), @sin(u) * @cos(v) };
        }
    };
    var i: u32 = 0;
    while (i < segments) : (i += 1) {
        const u_angle_1 = 2 * pi * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(segments));
        const u_angle_2 = 2 * pi * @as(f32, @floatFromInt(i + 1)) / @as(f32, @floatFromInt(segments));
        var j: u32 = 0;
        while (j < sides) : (j += 1) {
            const v1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(sides));
            const v2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(sides));
            const a = torus.pos(radius, tube_radius, u_angle_1, v1);
            const b = torus.pos(radius, tube_radius, u_angle_2, v1);
            const c = torus.pos(radius, tube_radius, u_angle_2, v2);
            const d = torus.pos(radius, tube_radius, u_angle_1, v2);
            const na = torus.normal(u_angle_1, v1);
            const nb = torus.normal(u_angle_2, v1);
            const nc = torus.normal(u_angle_2, v2);
            const nd = torus.normal(u_angle_1, v2);
            if (!addTri(&g_geo_buf, &idx, a, na, .{ 0, 0 }, d, nd, .{ 0, 1 }, c, nc, .{ 1, 1 })) return .{ .count = @intCast(idx) };
            if (!addTri(&g_geo_buf, &idx, a, na, .{ 0, 0 }, c, nc, .{ 1, 1 }, b, nb, .{ 1, 0 })) return .{ .count = @intCast(idx) };
        }
    }
    return .{ .count = @intCast(idx) };
}

const MeshSpec = struct {
    geometry: []const u8 = "box",
    size: [3]f32 = .{ 1, 1, 1 },
    radius: f32 = 0.5,
    tube_radius: f32 = 0.25,
    position: math.Vec3 = .{},
    rotation: math.Vec3 = .{},
    scale: math.Vec3 = .{ .x = 1, .y = 1, .z = 1 },
    color: [4]f32 = .{ 0.8, 0.8, 0.8, 1.0 },
    tex_w: u32 = 0,
    tex_h: u32 = 0,
    tex_rgba: ?[]const u8 = null,
};

// ════════════════════════════════════════════════════════════════════════
// Pipeline state
// ════════════════════════════════════════════════════════════════════════

var g_pipeline: ?*wgpu.RenderPipeline = null;
var g_vertex_buffer: ?*wgpu.Buffer = null;
var g_uniform_buffer: ?*wgpu.Buffer = null;
var g_bind_group: ?*wgpu.BindGroup = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;
var g_tex_bind_group_layout: ?*wgpu.BindGroupLayout = null;
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
    g_initialized = g_pipeline != null;
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
    const geo = node.scene3d_geometry orelse "box";
    if (std.mem.eql(u8, geo, "sphere")) {
        return node.scene3d_radius * max3(sx, sy, sz);
    }
    if (std.mem.eql(u8, geo, "plane")) {
        const hx = node.scene3d_size_x * sx * 0.5;
        const hz = node.scene3d_size_z * sz * 0.5;
        return @sqrt(hx * hx + hz * hz);
    }
    if (std.mem.eql(u8, geo, "cylinder") or std.mem.eql(u8, geo, "cone")) {
        const r = node.scene3d_radius * @max(sx, sz);
        const hy = node.scene3d_size_y * sy * 0.5;
        return @sqrt(r * r + hy * hy);
    }
    if (std.mem.eql(u8, geo, "torus")) {
        return (node.scene3d_radius + node.scene3d_tube_radius) * @max(sx, sz);
    }
    const hx = node.scene3d_size_x * sx * 0.5;
    const hy = node.scene3d_size_y * sy * 0.5;
    const hz = node.scene3d_size_z * sz * 0.5;
    return @sqrt(hx * hx + hy * hy + hz * hz);
}

fn buildMeshSpec(node: *const Node) MeshSpec {
    return .{
        .geometry = node.scene3d_geometry orelse "box",
        .size = .{ node.scene3d_size_x, node.scene3d_size_y, node.scene3d_size_z },
        .radius = node.scene3d_radius,
        .tube_radius = node.scene3d_tube_radius,
        .position = .{ .x = node.scene3d_pos_x, .y = node.scene3d_pos_y, .z = node.scene3d_pos_z },
        .rotation = .{ .x = node.scene3d_rot_x, .y = node.scene3d_rot_y, .z = node.scene3d_rot_z },
        .scale = .{ .x = node.scene3d_scale_x, .y = node.scene3d_scale_y, .z = node.scene3d_scale_z },
        .color = .{ node.scene3d_color_r, node.scene3d_color_g, node.scene3d_color_b, 1.0 },
        .tex_w = node.scene3d_tex_w,
        .tex_h = node.scene3d_tex_h,
        .tex_rgba = node.scene3d_tex_rgba,
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

fn generateGeometry(spec: MeshSpec) u32 {
    if (std.mem.eql(u8, spec.geometry, "sphere")) {
        return generateSphere(spec.radius, 24, 16).count;
    }
    if (std.mem.eql(u8, spec.geometry, "plane")) {
        return generatePlane(spec.size[0], spec.size[2]).count;
    }
    if (std.mem.eql(u8, spec.geometry, "cylinder")) {
        return generateCylinder(spec.radius, spec.size[1], 24).count;
    }
    if (std.mem.eql(u8, spec.geometry, "cone")) {
        return generateCone(spec.radius, spec.size[1], 24).count;
    }
    if (std.mem.eql(u8, spec.geometry, "torus")) {
        return generateTorus(spec.radius, spec.tube_radius, 24, 16).count;
    }
    return generateBox(spec.size[0], spec.size[1], spec.size[2]).count;
}

fn drawMesh(pass: anytype, queue: *wgpu.Queue, uniform_index: *u32, vert_byte_offset: *u64, vp: math.Mat4, cam_pos: math.Vec3, light_dir: [3]f32, light_color: [3]f32, ambient_color: [3]f32, fog_color: [3]f32, fog_near: f32, fog_far: f32, spec: MeshSpec) void {
    const vert_count = generateGeometry(spec);
    if (vert_count == 0) return;
    if (uniform_index.* >= MAX_DRAW_UNIFORMS) return;

    const vert_bytes: u64 = @as(u64, vert_count) * @sizeOf(Vertex);
    const buffer_capacity_bytes: u64 = @as(u64, MAX_FRAME_VERTS) * @sizeOf(Vertex);
    if (vert_byte_offset.* + vert_bytes > buffer_capacity_bytes) return;

    // Each mesh writes at a unique cumulative offset so that all the queued
    // writeBuffer calls survive into the eventual draws — without this, a
    // shared offset 0 means later writes clobber earlier ones and every
    // draw reads the same final blob.
    queue.writeBuffer(g_vertex_buffer.?, vert_byte_offset.*, @ptrCast(&g_geo_buf), vert_bytes);

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
    if (tex_bg) |bg| pass.setBindGroup(1, bg, 0, null);
    pass.setVertexBuffer(0, g_vertex_buffer.?, vert_byte_offset.*, vert_bytes);
    pass.draw(vert_count, 1, 0, 0);
    vert_byte_offset.* += vert_bytes;
}

fn drawSceneGuides(pass: anytype, queue: *wgpu.Queue, uniform_index: *u32, vert_byte_offset: *u64, vp: math.Mat4, cam_pos: math.Vec3, light_dir: [3]f32, light_color: [3]f32, ambient_color: [3]f32, fog_color: [3]f32, fog_near: f32, fog_far: f32, scene_extent: f32, show_grid: bool, show_axes: bool) void {
    if (show_grid) {
        const spacing: f32 = if (scene_extent > 24.0) 2.0 else 1.0;
        const steps: i32 = @intFromFloat(@ceil(std.math.clamp(scene_extent, 12.0, 36.0) / spacing));
        const grid_half = @as(f32, @floatFromInt(steps)) * spacing;
        const center_x = @round(cam_pos.x / spacing) * spacing;
        const center_z = @round(cam_pos.z / spacing) * spacing;

        var step: i32 = -steps;
        while (step <= steps) : (step += 1) {
            const offset = @as(f32, @floatFromInt(step)) * spacing;
            const is_major = @mod(@abs(step), 5) == 0;
            const thickness: f32 = if (is_major) 0.06 else 0.025;
            const tint: f32 = if (is_major) 0.42 else 0.22;
            const line_color = [4]f32{
                std.math.clamp(fog_color[0] + tint, 0.18, 0.62),
                std.math.clamp(fog_color[1] + tint, 0.20, 0.66),
                std.math.clamp(fog_color[2] + tint, 0.24, 0.72),
                1.0,
            };
            const line_x = center_x + offset;
            const line_z = center_z + offset;

            if (@abs(line_x - cam_pos.x) > spacing * 0.45) {
                drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
                    .geometry = "box",
                    .size = .{ thickness, thickness, grid_half * 2.0 },
                    .position = .{ .x = line_x, .y = 0.02, .z = center_z },
                    .color = line_color,
                });
            }
            if (@abs(line_z - cam_pos.z) > spacing * 0.45) {
                drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
                    .geometry = "box",
                    .size = .{ grid_half * 2.0, thickness, thickness },
                    .position = .{ .x = center_x, .y = 0.02, .z = line_z },
                    .color = line_color,
                });
            }
        }

        // Exact camera-centered bearings: keep the global snapped grid, but draw
        // one local cross through the camera so "straight ahead" is not biased by floor().
        const focus_color = [4]f32{
            std.math.clamp(fog_color[0] + 0.52, 0.28, 0.72),
            std.math.clamp(fog_color[1] + 0.54, 0.30, 0.76),
            std.math.clamp(fog_color[2] + 0.58, 0.36, 0.82),
            1.0,
        };
        drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
            .geometry = "box",
            .size = .{ 0.05, 0.05, grid_half * 2.0 },
            .position = .{ .x = cam_pos.x, .y = 0.03, .z = center_z },
            .color = focus_color,
        });
        drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
            .geometry = "box",
            .size = .{ grid_half * 2.0, 0.05, 0.05 },
            .position = .{ .x = center_x, .y = 0.03, .z = cam_pos.z },
            .color = focus_color,
        });
    }

    if (show_axes) {
        const axis_len = std.math.clamp(scene_extent * 0.18, 2.5, 6.0);
        drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
            .geometry = "box",
            .size = .{ axis_len, 0.07, 0.07 },
            .position = .{ .x = axis_len * 0.5, .y = 0.05, .z = 0 },
            .color = .{ 0.92, 0.28, 0.24, 1.0 },
        });
        drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
            .geometry = "box",
            .size = .{ 0.07, axis_len, 0.07 },
            .position = .{ .x = 0, .y = axis_len * 0.5, .z = 0 },
            .color = .{ 0.28, 0.82, 0.36, 1.0 },
        });
        drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
            .geometry = "box",
            .size = .{ 0.07, 0.07, axis_len },
            .position = .{ .x = 0, .y = 0.05, .z = axis_len * 0.5 },
            .color = .{ 0.28, 0.52, 0.94, 1.0 },
        });
        drawMesh(pass, queue, uniform_index, vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, .{
            .geometry = "box",
            .size = .{ 0.16, 0.16, 0.16 },
            .position = .{ .x = 0, .y = 0.08, .z = 0 },
            .color = .{ 0.94, 0.94, 0.96, 1.0 },
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

pub fn update(_: f32) void {}

/// Render a 3D.View node: walk children for 3D.Camera/Light/Mesh, draw to offscreen, composite.
pub fn render(node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    if (!g_initialized) init();
    if (!g_initialized) return false;
    const iw: u32 = @intFromFloat(@max(1, w));
    const ih: u32 = @intFromFloat(@max(1, h));
    const slot = acquireRt(iw, ih) orelse return false;
    const queue = core.getQueue() orelse return false;
    const device = core.getDevice() orelse return false;

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

    for (node.children) |*child| {
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
                    const len = @sqrt(dx * dx + dy * dy + dz * dz);
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

    // ── Begin render pass ──
    const color_view = slot.color_view orelse return false;
    const depth_view = slot.depth_view orelse return false;
    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("r3d") }) orelse return false;
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
        return false;
    };

    pass.setPipeline(g_pipeline.?);
    var uniform_index: u32 = 0;
    var vert_byte_offset: u64 = 0;

    // ── Draw each mesh ──
    for (node.children) |*child| {
        if (!child.scene3d_mesh) continue;
        drawMesh(pass, queue, &uniform_index, &vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, clear_color, fog_near, fog_far, buildMeshSpec(child));
    }

    if (node.scene3d_show_grid or node.scene3d_show_axes) {
        drawSceneGuides(pass, queue, &uniform_index, &vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, clear_color, fog_near, fog_far, scene_extent, node.scene3d_show_grid, node.scene3d_show_axes);
    }

    pass.end();
    pass.release();
    const command = encoder.finish(&.{ .label = wgpu.StringView.fromSlice("r3d_cmd") }) orelse {
        encoder.release();
        return false;
    };
    encoder.release();
    queue.submit(&.{command});
    command.release();

    if (slot.composite_bind_group) |bg| {
        // No-flip variant: the 3D pipeline writes the render-to-texture
        // already in final screen orientation, so the default Y-flip the
        // image compositor applies (correct for top-down sprite sources)
        // would invert the scene. Symmetric tiles hid this; an off-axis
        // avatar makes it obvious.
        images.queueQuadNoFlip(x, y, w, h, opacity, bg);
        return true;
    }
    return false;
}
