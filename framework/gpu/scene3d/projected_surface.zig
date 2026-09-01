//! projected_surface.zig — Surface Packages v1 (req_4784/4785).
//!
//! A Surface Package projects a coarse plane into real displaced geometry from
//! ONE cart-composed WGSL authority (PROJECTED_SURFACE_INTEGRATION.md — the
//! wavegeo integration). The cart pushes two composed modules through
//! __surface_package_formula (compute: `sp_eval`; render: `sp_rgb`) and
//! installs plane instances through __surface_package_set. A COMPUTE PREPASS —
//! the framework's first — evaluates the structural formula once per
//! install/param change and writes the Generated Surface Buffer (pos + normal
//! + chart coordinate per lattice vertex); the draw pass renders that buffer
//! with the ground pass's lighting. Static by ruling (capture-frame,
//! req_4782): nothing here evaluates per frame. Collision (next slice) reads
//! the SAME generated buffer back — Zig never re-implements the formula.

const std = @import("std");
const log = @import("../../diag/log.zig");
const wgpu = @import("wgpu");
const bu = @import("../buffer_upload.zig");
const shaders = @import("../shaders.zig");
const core = @import("../../dev_modules/gpu_api.zig");
const effect_assemble = @import("../effect_assemble.zig");
const compile_progress = @import("../compile_progress.zig");

const z3d = @import("root.zig");

// A wall with openings splits into multiple face bands, each its own surface —
// a real building wants dozens. Sized for a block of finished walls; the
// elastic-pool follow-up (grow, never cap — the machine is the wall) is named
// in PROJECTED_SURFACE_INTEGRATION.md.
pub const PROJ_POOL = 64;
pub const PROJ_DATA_FLOATS = 256;
/// Fail-closed lattice ceiling: a package demanding more vertices than this is
/// refused loudly (evaluation density is a declared budget, never a surprise).
pub const PROJ_MAX_VERTS = 1_050_000;
pub const PROJ_VERTEX_FLOATS = 8; // pos.xyz + nrm.xyz + sp.xy

/// Mirrors the WGSL ProjParams uniform (projected_compute_prefix) — 96 bytes,
/// vec3f rows padded to 16 by the trailing u32/f32 scalars.
pub const ProjParams = extern struct {
    origin: [3]f32,
    cols: u32,
    u_axis: [3]f32,
    rows: u32,
    v_axis: [3]f32,
    spacing: f32,
    n_axis: [3]f32,
    meters_per_unit: f32,
    sp_origin: [2]f32,
    /// 1 when the chart frame is left-handed (cross(u,v) opposes n_axis) —
    /// the compute normal and the index winding both flip to face n_axis.
    winding_flip: f32 = 0,
    _pad: f32 = 0,
};

pub const ProjSlot = struct {
    active: bool = false,
    id_hash: u64 = 0,
    data: [PROJ_DATA_FLOATS]f32 = @splat(0),
    data_len: u32 = 0,
    params: ProjParams = std.mem.zeroes(ProjParams),
    vertex_count: u32 = 0,
    index_count: u32 = 0,
    vbuf: ?*wgpu.Buffer = null, // the Generated Surface Buffer (storage | vertex)
    ibuf: ?*wgpu.Buffer = null,
    data_buf: ?*wgpu.Buffer = null, // structural D section (compute + render group1)
    params_buf: ?*wgpu.Buffer = null,
    render_bg: ?*wgpu.BindGroup = null, // g_ground_bgl over data_buf
    compute_bg: ?*wgpu.BindGroup = null,
    gen_dirty: bool = false,
    generated: bool = false,
    // ── the collision view (slice 3): a NESTED subset of the Generated
    // Surface Buffer, read back once per revision. Triangles are the
    // game/mesh_collision.zig soup shape (9 floats per triangle, world
    // space) — collision selects INDICES from the master surface; the
    // formula is never evaluated a second time anywhere.
    collision_triangles: ?[]f32 = null, // owned (c_allocator)
    collision_cols: u32 = 0,
    collision_rows: u32 = 0,
    measured_min_disp: f32 = 0, // meters along n_axis, from the readback
    measured_max_disp: f32 = 0,
    collision_ok: bool = false, // false = bounds gate failed (fail closed)
};

fn releaseSlotHost(s: *ProjSlot) void {
    if (s.collision_triangles) |old| std.heap.c_allocator.free(old);
    s.collision_triangles = null;
    s.collision_cols = 0;
    s.collision_rows = 0;
    s.collision_ok = false;
}

fn releaseSlotGpu(s: *ProjSlot) void {
    if (s.vbuf) |b| b.release();
    if (s.ibuf) |b| b.release();
    if (s.data_buf) |b| b.release();
    if (s.params_buf) |b| b.release();
    if (s.render_bg) |b| b.release();
    if (s.compute_bg) |b| b.release();
    s.vbuf = null;
    s.ibuf = null;
    s.data_buf = null;
    s.params_buf = null;
    s.render_bg = null;
    s.compute_bg = null;
}

/// __surface_package_formula: install/replace the two composed modules. The
/// compute module must define `fn sp_eval(sp: vec2f) -> SurfaceSample`; the
/// render module must define `fn sp_rgb(sp: vec2f, px: vec2f) -> vec3f`.
/// Hash-gated in ensureProjectedPipelines — an unchanged push is a no-op, a
/// hot-reload edit rebuilds both pipelines and regenerates every surface.
pub fn setProjectedFormulas(compute_wgsl: []const u8, render_wgsl: []const u8) void {
    const ccopy = std.heap.c_allocator.dupe(u8, compute_wgsl) catch return;
    const rcopy = std.heap.c_allocator.dupe(u8, render_wgsl) catch {
        std.heap.c_allocator.free(ccopy);
        return;
    };
    if (z3d.g_proj_compute_formula) |old| std.heap.c_allocator.free(old);
    if (z3d.g_proj_render_formula) |old| std.heap.c_allocator.free(old);
    z3d.g_proj_compute_formula = ccopy;
    z3d.g_proj_render_formula = rcopy;
}

/// __surface_package_set: install (or update) one projected plane.
/// `plane` = [origin.xyz, uAxis.xyz, vAxis.xyz, sizeU_m, sizeV_m, spacing_m,
/// metersPerUnit] (13 floats); `data` is the package's structural D section
/// (surfacePackage.ts surfacePackageData — the mat_param-compatible row).
pub fn setProjectedSurface(id: []const u8, plane: []const f32, data: []const f32) bool {
    if (plane.len < 13 or data.len == 0) return false;
    const spacing = plane[11];
    const meters_per_unit = plane[12];
    if (!(spacing > 0.0001) or !(meters_per_unit > 0.0001)) {
        log.print("[r3d-proj] REFUSED '{s}': spacing {d} / metersPerUnit {d} must be positive\n", .{ id, spacing, meters_per_unit });
        return false;
    }
    const size_u = plane[9];
    const size_v = plane[10];
    const cols: u32 = @as(u32, @intFromFloat(@max(1.0, @floor(size_u / spacing)))) + 1;
    const rows: u32 = @as(u32, @intFromFloat(@max(1.0, @floor(size_v / spacing)))) + 1;
    if (@as(u64, cols) * rows > PROJ_MAX_VERTS) {
        log.print("[r3d-proj] REFUSED '{s}': {d}x{d} lattice = {d} verts exceeds the {d} budget — raise spacing or shrink the plane\n", .{ id, cols, rows, @as(u64, cols) * rows, PROJ_MAX_VERTS });
        return false;
    }
    const kh = z3d.hashKey(id);
    var slot_index: ?usize = null;
    for (&z3d.g_proj_slots, 0..) |*s, i| {
        if (s.active and s.id_hash == kh) {
            slot_index = i;
            break;
        }
    }
    if (slot_index == null) {
        for (&z3d.g_proj_slots, 0..) |*s, i| {
            if (!s.active) {
                slot_index = i;
                break;
            }
        }
    }
    const si = slot_index orelse {
        log.print("[r3d-proj] pool full ({d}) — dropping surface '{s}'\n", .{ PROJ_POOL, id });
        return false;
    };
    const s = &z3d.g_proj_slots[si];
    // The chart frame's projection axis. cross(u,v) gives the frame's own
    // handedness; a caller with an AUTHORITATIVE outward normal (a wall
    // band's engine-emitted normal, plane[15..17]) supplies it, and when the
    // frame is left-handed relative to it (one side of every wall — band
    // quads wind by EDGE direction, not by side) the projection axis follows
    // the supplied normal and the geometry/winding flip to face it
    // (req_4786: the inward-projected invisible wall face).
    const u = plane[3..6];
    const v = plane[6..9];
    var n: [3]f32 = .{
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    };
    const nlen = @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (nlen < 0.0001) {
        log.print("[r3d-proj] REFUSED '{s}': degenerate plane axes\n", .{id});
        return false;
    }
    n = .{ n[0] / nlen, n[1] / nlen, n[2] / nlen };
    var winding_flip: f32 = 0;
    if (plane.len >= 18) {
        const dot_ref = n[0] * plane[15] + n[1] * plane[16] + n[2] * plane[17];
        if (dot_ref < 0) {
            n = .{ -n[0], -n[1], -n[2] };
            winding_flip = 1;
        }
    }
    if (data.len > PROJ_DATA_FLOATS) {
        log.print("[r3d-proj] '{s}' data is {d} floats, cap {d} — TRUNCATED\n", .{ id, data.len, PROJ_DATA_FLOATS });
    }
    const dn: u32 = @intCast(@min(data.len, PROJ_DATA_FLOATS));
    @memcpy(s.data[0..dn], data[0..dn]);
    s.data_len = dn;
    s.params = .{
        .origin = .{ plane[0], plane[1], plane[2] },
        .cols = cols,
        .u_axis = .{ plane[3], plane[4], plane[5] },
        .rows = rows,
        .v_axis = .{ plane[6], plane[7], plane[8] },
        .spacing = spacing,
        .n_axis = n,
        .meters_per_unit = meters_per_unit,
        // Optional chart origin (plane[13..14], sp units): a wall band that
        // starts mid-run hands its columnStart/rowBottom here so courses
        // continue seamlessly across opening-split bands and run segments.
        .sp_origin = .{
            if (plane.len >= 15) plane[13] else 0,
            if (plane.len >= 15) plane[14] else 0,
        },
        .winding_flip = winding_flip,
    };
    s.vertex_count = cols * rows;
    s.index_count = (cols - 1) * (rows - 1) * 6;
    s.id_hash = kh;
    s.active = true;
    s.gen_dirty = true;
    s.generated = false;
    releaseSlotHost(s); // a re-install invalidates the collision view too
    return true;
}

/// __surface_package_clear: empty id clears every projected surface.
pub fn clearProjectedSurfaces(id: []const u8) void {
    const kh = if (id.len > 0) z3d.hashKey(id) else 0;
    for (&z3d.g_proj_slots) |*s| {
        if (!s.active) continue;
        if (id.len > 0 and s.id_hash != kh) continue;
        releaseSlotGpu(s);
        releaseSlotHost(s);
        s.* = .{};
    }
}

pub fn projActiveCount() u32 {
    var count: u32 = 0;
    for (&z3d.g_proj_slots) |*s| {
        if (s.active and s.generated) count += 1;
    }
    return count;
}

/// Build/rebuild both pipelines when the cart-pushed formulas change (the
/// ensureGroundPipeline discipline: hash-gated, loud on failure, and a formula
/// change dirties every slot so surfaces regenerate from the new authority).
pub fn ensureProjectedPipelines(io: std.Io, environ: *const std.process.Environ.Map, device: *wgpu.Device) void {
    const compute_formula = z3d.g_proj_compute_formula orelse return;
    const render_formula = z3d.g_proj_render_formula orelse return;
    const ch = std.hash.Wyhash.hash(0, compute_formula);
    const rh = std.hash.Wyhash.hash(1, render_formula);
    const combined = ch ^ rh;
    if (z3d.g_proj_pipeline != null and z3d.g_proj_compute_pipeline != null and combined == z3d.g_proj_built_hash) return;
    if (z3d.g_bind_group_layout == null or z3d.g_ground_bgl == null) return;

    if (z3d.g_proj_compute_pipeline) |old| old.release();
    z3d.g_proj_compute_pipeline = null;
    if (z3d.g_proj_pipeline) |old| old.release();
    z3d.g_proj_pipeline = null;

    // ── compute BGL (once): P uniform + D structural section + OUT buffer ──
    if (z3d.g_proj_compute_bgl == null) {
        const entries = [_]wgpu.BindGroupLayoutEntry{
            .{ .binding = 0, .visibility = wgpu.ShaderStages.compute, .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = 0 } },
            .{ .binding = 1, .visibility = wgpu.ShaderStages.compute, .buffer = .{ .type = .read_only_storage, .has_dynamic_offset = 0, .min_binding_size = 0 } },
            .{ .binding = 2, .visibility = wgpu.ShaderStages.compute, .buffer = .{ .type = .storage, .has_dynamic_offset = 0, .min_binding_size = 0 } },
        };
        z3d.g_proj_compute_bgl = device.createBindGroupLayout(&.{
            .entry_count = entries.len,
            .entries = &entries,
        }) orelse return;
    }

    // ── compute pipeline ──
    {
        const wgsl = std.fmt.allocPrint(std.heap.c_allocator, "{s}\n{s}\n{s}\n{s}", .{
            shaders.projected_compute_prefix, effect_assemble.MATH, compute_formula, shaders.projected_compute_epilogue,
        }) catch {
            log.print("[r3d-proj] ERROR: out of memory assembling the compute module ({d}B formula)\n", .{compute_formula.len});
            return;
        };
        defer std.heap.c_allocator.free(wgsl);
        var progress = compile_progress.CompileProgress{};
        progress.start(io, environ, wgsl.len);
        defer progress.finishMemory();
        defer progress.stop();
        const sm_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "r3d_proj_compute", .code = wgsl });
        const sm = device.createShaderModule(&sm_desc) orelse {
            log.print("[r3d-proj] ERROR: compute formula WGSL FAILED TO COMPILE (hash {x}, {d}B) — projected surfaces will NOT generate; check the wgpu validation output above.\n", .{ ch, compute_formula.len });
            return;
        };
        defer sm.release();
        const gl = [_]?*wgpu.BindGroupLayout{z3d.g_proj_compute_bgl.?};
        const pl = device.createPipelineLayout(&.{
            .bind_group_layout_count = gl.len,
            .bind_group_layouts = @ptrCast(&gl),
        }) orelse return;
        defer pl.release();
        z3d.g_proj_compute_pipeline = device.createComputePipeline(&.{
            .label = wgpu.StringView.fromSlice("r3d_proj_compute"),
            .layout = pl,
            .compute = .{ .module = sm, .entry_point = wgpu.StringView.fromSlice("cs_main") },
        });
        if (z3d.g_proj_compute_pipeline == null) {
            log.print("[r3d-proj] ERROR: createComputePipeline returned null (hash {x})\n", .{ch});
            return;
        }
        progress.finishOk();
    }

    // ── render pipeline ──
    {
        const wgsl = std.fmt.allocPrint(std.heap.c_allocator, "{s}\n{s}\n{s}\n{s}", .{
            shaders.projected_render_prefix, effect_assemble.MATH, render_formula, shaders.projected_render_epilogue,
        }) catch {
            log.print("[r3d-proj] ERROR: out of memory assembling the render module ({d}B formula)\n", .{render_formula.len});
            return;
        };
        defer std.heap.c_allocator.free(wgsl);
        var progress = compile_progress.CompileProgress{};
        progress.start(io, environ, wgsl.len);
        defer progress.finishMemory();
        defer progress.stop();
        const sm_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "r3d_proj_render", .code = wgsl });
        const sm = device.createShaderModule(&sm_desc) orelse {
            log.print("[r3d-proj] ERROR: render formula WGSL FAILED TO COMPILE (hash {x}, {d}B) — projected surfaces will NOT draw; check the wgpu validation output above.\n", .{ rh, render_formula.len });
            return;
        };
        defer sm.release();
        const gl = [_]?*wgpu.BindGroupLayout{ z3d.g_bind_group_layout.?, z3d.g_ground_bgl.? };
        const pl = device.createPipelineLayout(&.{
            .bind_group_layout_count = gl.len,
            .bind_group_layouts = @ptrCast(&gl),
        }) orelse return;
        defer pl.release();
        const vert_attrs = [_]wgpu.VertexAttribute{
            .{ .format = .float32x3, .offset = 0, .shader_location = 0 },
            .{ .format = .float32x3, .offset = 12, .shader_location = 1 },
            .{ .format = .float32x2, .offset = 24, .shader_location = 2 },
        };
        const vert_layouts = [_]wgpu.VertexBufferLayout{
            .{ .step_mode = .vertex, .array_stride = PROJ_VERTEX_FLOATS * @sizeOf(f32), .attribute_count = vert_attrs.len, .attributes = &vert_attrs },
        };
        const color_target = wgpu.ColorTargetState{
            .format = .rgba8_unorm,
            .blend = &wgpu.BlendState.premultiplied_alpha_blending,
            .write_mask = wgpu.ColorWriteMasks.all,
        };
        const frag = wgpu.FragmentState{
            .module = sm,
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
        z3d.g_proj_pipeline = device.createRenderPipeline(&.{
            .layout = pl,
            .vertex = .{ .module = sm, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = vert_layouts.len, .buffers = &vert_layouts },
            .primitive = .{ .topology = .triangle_list, .cull_mode = .back, .front_face = .ccw },
            .depth_stencil = &depth_stencil,
            .multisample = .{},
            .fragment = &frag,
        });
        if (z3d.g_proj_pipeline == null) {
            log.print("[r3d-proj] ERROR: createRenderPipeline returned null (hash {x})\n", .{rh});
            return;
        }
        progress.finishOk();
    }

    z3d.g_proj_built_hash = combined;
    // A new authority invalidates every generated surface AND its collision view.
    for (&z3d.g_proj_slots) |*s| {
        if (s.active) {
            s.gen_dirty = true;
            s.generated = false;
            releaseSlotHost(s);
        }
    }
}

/// Run the compute prepass for every dirty slot — called once per frame from
/// drawScene, but a STATIC package generates exactly once per install/param/
/// formula change (gen_dirty), so steady state records nothing.
pub fn generateProjectedSurfaces(io: std.Io, environ: *const std.process.Environ.Map, device: *wgpu.Device, queue: *wgpu.Queue) void {
    var any_active = false;
    for (&z3d.g_proj_slots) |*s| {
        if (s.active) any_active = true;
    }
    if (!any_active) return;
    ensureProjectedPipelines(io, environ, device);
    const cp = z3d.g_proj_compute_pipeline orelse return;

    var encoder: ?*wgpu.CommandEncoder = null;
    defer if (encoder) |e| e.release();

    for (&z3d.g_proj_slots) |*s| {
        if (!s.active or !s.gen_dirty) continue;
        const vbytes: u64 = @as(u64, s.vertex_count) * PROJ_VERTEX_FLOATS * @sizeOf(f32);

        // (Re)create the slot's GPU residency at the current lattice size.
        releaseSlotGpu(s);
        s.vbuf = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("r3d_proj_generated"),
            .size = vbytes,
            .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.storage | wgpu.BufferUsages.copy_src,
            .mapped_at_creation = 0,
        }) orelse continue;
        s.params_buf = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("r3d_proj_params"),
            .size = @sizeOf(ProjParams),
            .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        }) orelse continue;
        s.data_buf = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("r3d_proj_data"),
            .size = PROJ_DATA_FLOATS * @sizeOf(f32),
            .usage = wgpu.BufferUsages.storage | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        }) orelse continue;

        // Host-generated grid indices, wound CCW toward the plane normal.
        {
            const cols = s.params.cols;
            const rows = s.params.rows;
            const idx = std.heap.c_allocator.alloc(u32, s.index_count) catch continue;
            defer std.heap.c_allocator.free(idx);
            // A left-handed chart frame (winding_flip — see setProjectedSurface)
            // reverses the winding so the front faces follow n_axis.
            const flipped = s.params.winding_flip > 0.5;
            var w: usize = 0;
            var j: u32 = 0;
            while (j + 1 < rows) : (j += 1) {
                var i: u32 = 0;
                while (i + 1 < cols) : (i += 1) {
                    const a = j * cols + i;
                    const b = j * cols + i + 1;
                    const c = (j + 1) * cols + i;
                    const d = (j + 1) * cols + i + 1;
                    if (flipped) {
                        idx[w] = a;
                        idx[w + 1] = d;
                        idx[w + 2] = b;
                        idx[w + 3] = a;
                        idx[w + 4] = c;
                        idx[w + 5] = d;
                    } else {
                        idx[w] = a;
                        idx[w + 1] = b;
                        idx[w + 2] = d;
                        idx[w + 3] = a;
                        idx[w + 4] = d;
                        idx[w + 5] = c;
                    }
                    w += 6;
                }
            }
            s.ibuf = device.createBuffer(&.{
                .label = wgpu.StringView.fromSlice("r3d_proj_indices"),
                .size = @as(u64, s.index_count) * @sizeOf(u32),
                .usage = wgpu.BufferUsages.index | wgpu.BufferUsages.copy_dst,
                .mapped_at_creation = 0,
            }) orelse continue;
            bu.writeTypedBuffer(queue, s.ibuf.?, 0, u32, idx);
        }

        bu.writeValue(queue, s.params_buf.?, 0, &s.params);
        bu.writeTypedBuffer(queue, s.data_buf.?, 0, f32, s.data[0..PROJ_DATA_FLOATS]);

        const compute_entries = [_]wgpu.BindGroupEntry{
            .{ .binding = 0, .buffer = s.params_buf.?, .offset = 0, .size = @sizeOf(ProjParams) },
            .{ .binding = 1, .buffer = s.data_buf.?, .offset = 0, .size = PROJ_DATA_FLOATS * @sizeOf(f32) },
            .{ .binding = 2, .buffer = s.vbuf.?, .offset = 0, .size = vbytes },
        };
        s.compute_bg = device.createBindGroup(&.{
            .layout = z3d.g_proj_compute_bgl.?,
            .entry_count = compute_entries.len,
            .entries = &compute_entries,
        }) orelse continue;
        s.render_bg = device.createBindGroup(&.{
            .layout = z3d.g_ground_bgl.?,
            .entry_count = 1,
            .entries = @ptrCast(&wgpu.BindGroupEntry{
                .binding = 0,
                .buffer = s.data_buf.?,
                .offset = 0,
                .size = PROJ_DATA_FLOATS * @sizeOf(f32),
            }),
        }) orelse continue;

        if (encoder == null) {
            encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("r3d_proj_gen") });
            if (encoder == null) return;
        }
        const pass = encoder.?.beginComputePass(null) orelse continue;
        pass.setPipeline(cp);
        pass.setBindGroup(0, s.compute_bg.?, 0, null);
        pass.dispatchWorkgroups((s.params.cols + 7) / 8, (s.params.rows + 7) / 8, 1);
        pass.end();
        pass.release();
        s.gen_dirty = false;
        s.generated = true;
        log.print("[r3d-proj] generated surface (hash {x}): {d}x{d} lattice, {d} verts, {d} indices\n", .{ s.id_hash, s.params.cols, s.params.rows, s.vertex_count, s.index_count });
    }

    if (encoder) |e| {
        const command = e.finish(&.{ .label = wgpu.StringView.fromSlice("r3d_proj_gen_cmd") }) orelse return;
        queue.submit(&.{command});
        command.release();
        // Slice 3: pull the collision view out of the freshly generated
        // buffers. Install-time only — the blocking poll never runs on a
        // steady-state frame.
        for (&z3d.g_proj_slots) |*s| {
            if (s.active and s.generated and s.collision_triangles == null) {
                readbackCollisionView(device, queue, s);
            }
        }
    }
}

/// The structural D section's extras ride after the param table (mirrors
/// surfacePackage.ts surfacePackageDataLayout): extrasBase = 7 + paramCount,
/// then [captureTime, captureStep, metersPerUnit, periodicU, minDisplacement,
/// maxDisplacement, renderSpacing, collisionSpacing].
fn slotExtras(s: *const ProjSlot) ?struct { min_disp: f32, max_disp: f32, render_spacing: f32, collision_spacing: f32 } {
    if (s.data_len < 7) return null;
    const param_count: u32 = @intFromFloat(@max(0, s.data[6]));
    const extras_base = 7 + param_count;
    if (extras_base + 8 > s.data_len) return null;
    return .{
        .min_disp = s.data[extras_base + 4],
        .max_disp = s.data[extras_base + 5],
        .render_spacing = s.data[extras_base + 6],
        .collision_spacing = s.data[extras_base + 7],
    };
}

/// Read the Generated Surface Buffer back ONCE and derive the collision view:
/// a nested lattice subset (collisionSpacing / renderSpacing stride) built
/// into the game/mesh_collision.zig triangle-soup shape, plus the measured
/// displacement envelope. The declared bounds are ENFORCED here — a formula
/// escaping its conservative envelope is exactly the wrongness the bake must
/// refuse (fail closed: the surface keeps rendering, collision is refused
/// LOUDLY until the package's bounds or formula are fixed).
fn readbackCollisionView(device: *wgpu.Device, queue: *wgpu.Queue, s: *ProjSlot) void {
    const vb = s.vbuf orelse return;
    const vbytes: u64 = @as(u64, s.vertex_count) * PROJ_VERTEX_FLOATS * @sizeOf(f32);
    const staging = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("r3d_proj_readback"),
        .size = vbytes,
        .usage = wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.map_read,
        .mapped_at_creation = 0,
    }) orelse return;
    defer staging.release();
    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("r3d_proj_readback_cmd") }) orelse return;
    encoder.copyBufferToBuffer(vb, 0, staging, 0, vbytes);
    const cmd = encoder.finish(&.{ .label = wgpu.StringView.fromSlice("r3d_proj_readback_fin") }) orelse {
        encoder.release();
        return;
    };
    encoder.release();
    queue.submit(&.{cmd});
    cmd.release();

    var done: bool = false;
    const cb_struct = struct {
        fn cb(status: wgpu.MapAsyncStatus, _: wgpu.StringView, userdata1: ?*anyopaque, _: ?*anyopaque) callconv(.c) void {
            _ = status;
            const done_ptr: *bool = @ptrCast(@alignCast(userdata1.?));
            done_ptr.* = true;
        }
    };
    _ = staging.mapAsync(wgpu.MapModes.read, 0, @intCast(vbytes), .{ .callback = cb_struct.cb, .userdata1 = @ptrCast(&done) });
    while (!done) {
        _ = device.poll(true, null);
    }
    const mapped_ptr = staging.getConstMappedRange(0, @intCast(vbytes)) orelse return;
    defer staging.unmap();
    const verts: []const f32 = @as([*]const f32, @ptrCast(@alignCast(mapped_ptr)))[0 .. s.vertex_count * PROJ_VERTEX_FLOATS];

    const extras = slotExtras(s) orelse {
        log.print("[r3d-proj] collision REFUSED (hash {x}): structural D section carries no extras — repack with surfacePackageData\n", .{s.id_hash});
        return;
    };
    const ratio = extras.collision_spacing / @max(extras.render_spacing, 0.000001);
    const stride: u32 = @max(1, @as(u32, @intFromFloat(@round(ratio))));
    const ccols: u32 = (s.params.cols - 1) / stride + 1;
    const crows: u32 = (s.params.rows - 1) / stride + 1;

    // Measured displacement envelope over the FULL lattice (the render truth,
    // not just the subset): disp = dot(pos - plane_base(i,j), n_axis).
    var min_disp: f32 = std.math.floatMax(f32);
    var max_disp: f32 = -std.math.floatMax(f32);
    var j: u32 = 0;
    while (j < s.params.rows) : (j += 1) {
        var i: u32 = 0;
        while (i < s.params.cols) : (i += 1) {
            const base = (j * s.params.cols + i) * PROJ_VERTEX_FLOATS;
            const x_m = @as(f32, @floatFromInt(i)) * s.params.spacing;
            const y_m = @as(f32, @floatFromInt(j)) * s.params.spacing;
            var disp: f32 = 0;
            inline for (0..3) |axis| {
                const flat = s.params.origin[axis] + s.params.u_axis[axis] * x_m + s.params.v_axis[axis] * y_m;
                disp += (verts[base + axis] - flat) * s.params.n_axis[axis];
            }
            if (disp < min_disp) min_disp = disp;
            if (disp > max_disp) max_disp = disp;
        }
    }
    s.measured_min_disp = min_disp;
    s.measured_max_disp = max_disp;
    const tolerance: f32 = 0.0005; // half a millimeter of f32 slack
    if (min_disp < extras.min_disp - tolerance or max_disp > extras.max_disp + tolerance) {
        log.print("[r3d-proj] collision REFUSED (hash {x}): measured displacement [{d:.4}, {d:.4}]m escapes the declared bounds [{d:.4}, {d:.4}]m — fix the package bounds or the formula (fail closed)\n", .{ s.id_hash, min_disp, max_disp, extras.min_disp, extras.max_disp });
        s.collision_ok = false;
        return;
    }

    // Build the nested-subset triangle soup (9 floats per triangle, world
    // space, same winding as the render indices).
    const tri_count: u64 = @as(u64, ccols - 1) * (crows - 1) * 2;
    const soup = std.heap.c_allocator.alloc(f32, tri_count * 9) catch return;
    var w: usize = 0;
    var cj: u32 = 0;
    while (cj + 1 < crows) : (cj += 1) {
        var ci: u32 = 0;
        while (ci + 1 < ccols) : (ci += 1) {
            const ia = (@min(cj * stride, s.params.rows - 1) * s.params.cols + @min(ci * stride, s.params.cols - 1)) * PROJ_VERTEX_FLOATS;
            const ib = (@min(cj * stride, s.params.rows - 1) * s.params.cols + @min((ci + 1) * stride, s.params.cols - 1)) * PROJ_VERTEX_FLOATS;
            const ic = (@min((cj + 1) * stride, s.params.rows - 1) * s.params.cols + @min(ci * stride, s.params.cols - 1)) * PROJ_VERTEX_FLOATS;
            const id = (@min((cj + 1) * stride, s.params.rows - 1) * s.params.cols + @min((ci + 1) * stride, s.params.cols - 1)) * PROJ_VERTEX_FLOATS;
            inline for (.{ ia, ib, id, ia, id, ic }) |vi| {
                soup[w] = verts[vi];
                soup[w + 1] = verts[vi + 1];
                soup[w + 2] = verts[vi + 2];
                w += 3;
            }
        }
    }
    if (s.collision_triangles) |old| std.heap.c_allocator.free(old);
    s.collision_triangles = soup;
    s.collision_cols = ccols;
    s.collision_rows = crows;
    s.collision_ok = true;
    log.print("[r3d-proj] collision view (hash {x}): {d}x{d} nested lattice (stride {d}) -> {d} triangles; measured displacement [{d:.4}, {d:.4}]m inside declared [{d:.4}, {d:.4}]m\n", .{ s.id_hash, ccols, crows, stride, tri_count, min_disp, max_disp, extras.min_disp, extras.max_disp });
}

/// __surface_package_info: JSON status of one installed surface — the
/// verification door (the demo route and future tooling read it; the shot
/// harness asserts through it). Caller frees.
pub fn projInfoJsonAlloc(id: []const u8) ?[]u8 {
    const kh = z3d.hashKey(id);
    for (&z3d.g_proj_slots) |*s| {
        if (!s.active or s.id_hash != kh) continue;
        const tri_count: u64 = if (s.collision_triangles) |t| t.len / 9 else 0;
        return std.fmt.allocPrint(
            std.heap.c_allocator,
            "{{\"generated\":{},\"vertices\":{d},\"indices\":{d},\"collisionOk\":{},\"collisionCols\":{d},\"collisionRows\":{d},\"collisionTriangles\":{d},\"measuredMinDisp\":{d:.5},\"measuredMaxDisp\":{d:.5}}}",
            .{ s.generated, s.vertex_count, s.index_count, s.collision_ok, s.collision_cols, s.collision_rows, tri_count, s.measured_min_disp, s.measured_max_disp },
        ) catch null;
    }
    return null;
}

/// Draw every generated surface into the scene's render pass (recorded after
/// the ground pass, before the region overlay). Positions are world-space; the
/// only per-slot state is the structural D bind group and the two buffers.
pub fn drawProjectedSurfaces(pass: *wgpu.RenderPassEncoder) void {
    const rp = z3d.g_proj_pipeline orelse return;
    var pipeline_bound = false;
    for (&z3d.g_proj_slots) |*s| {
        if (!s.active or !s.generated) continue;
        const vb = s.vbuf orelse continue;
        const ib = s.ibuf orelse continue;
        const bg = s.render_bg orelse continue;
        if (!pipeline_bound) {
            pass.setPipeline(rp);
            pass.setBindGroup(0, z3d.g_bind_group.?, 0, null);
            pipeline_bound = true;
        }
        pass.setBindGroup(1, bg, 0, null);
        const vbytes: u64 = @as(u64, s.vertex_count) * PROJ_VERTEX_FLOATS * @sizeOf(f32);
        pass.setVertexBuffer(0, vb, 0, vbytes);
        pass.setIndexBuffer(ib, .uint32, 0, @as(u64, s.index_count) * @sizeOf(u32));
        pass.drawIndexed(s.index_count, 1, 0, 0, 0);
        z3d.recordDraw(s.vertex_count, 1);
    }
}
