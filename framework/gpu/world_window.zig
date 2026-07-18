//! framework/gpu/world_window.zig — the COMPILED-WORLD POP-OUT WINDOW
//! (WORLDWIN-0611, structure review §6/§10.2 re-aimed at /compiled).
//!
//! A second OS window running the full wgpu pipeline. The architecture makes
//! this cheap: scene3d already renders every scene to its OWN render-to-
//! texture (never the swapchain), and drawScene is encoder-self-contained —
//! so this module only needs (1) an extra surface on the SAME device
//! (gpu.createWindowSurface/configureExtraSurface), (2) a caller-owned
//! detached render target (scene3d.DetachedTarget — outside the per-frame
//! pool), and (3) a one-triangle blit pass RT → the window's swapchain.
//!
//! The world runtime is a normal world_loader mount under a reserved node id,
//! so it streams/steps/walks exactly like the embedded /compiled route — but
//! into ITS window, every frame, regardless of which route the editor shows.
//! Movement keys cost zero plumbing: world_loader reads SDL's process-wide
//! keyboard state. This module routes only its own window's events: click
//! captures the mouse for look, Esc releases, RMB aims, close/resize do what
//! they say. Events for this window are CONSUMED so editor hotkeys never
//! fire while walking the world.
//!
//! Driven from the engine loop: engine.zig calls routeEvent() in the SDL
//! poll loop and frame() after the main gpu.frame(). One window for now —
//! the door is open/close/status, not a window manager.

const std = @import("std");
const wgpu = @import("wgpu");
const c = @import("../c.zig").imports;
const gpu = @import("gpu.zig");
const scene3d = @import("3d.zig");
const rects = @import("rects.zig");
const text = @import("text.zig");
const world_loader = @import("../world_loader.zig");
const log = @import("../diag/log.zig");

/// world_loader mounts are keyed by node id; reconciler ids are small and
/// dense, so the pop-out reserves one far outside that space.
pub const WINDOW_NODE_ID: u32 = 0xFFFF_FF01;

const blit_wgsl =
    \\@group(0) @binding(0) var src_tex: texture_2d<f32>;
    \\@group(0) @binding(1) var src_samp: sampler;
    \\
    \\struct VsOut {
    \\    @builtin(position) pos: vec4f,
    \\    @location(0) uv: vec2f,
    \\};
    \\
    \\@vertex
    \\fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    \\    var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    \\    let p = tri[vi];
    \\    var out: VsOut;
    \\    out.pos = vec4f(p, 0.0, 1.0);
    \\    // The 3D RT is written in final screen orientation (row 0 = top, the
    \\    // images pipeline's no-flip convention) — clip-space +Y is the top,
    \\    // so v runs 0 at +1 down to 1 at -1.
    \\    out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VsOut) -> @location(0) vec4f {
    \\    return textureSample(src_tex, src_samp, in.uv);
    \\}
;

var g_window: ?*c.SDL_Window = null;
var g_window_id: u32 = 0;
var g_surface: ?*wgpu.Surface = null;
var g_surface_format: wgpu.TextureFormat = .bgra8_unorm;
var g_width: u32 = 0;
var g_height: u32 = 0;
var g_target: scene3d.DetachedTarget = .{};
var g_mouse_captured: bool = false;
var g_aiming: bool = false;

// blit machinery — pipeline built lazily against the surface's format;
// the bind group recreates whenever the RT view identity changes (resize)
var g_blit_pipeline: ?*wgpu.RenderPipeline = null;
var g_blit_pipeline_format: wgpu.TextureFormat = .bgra8_unorm;
var g_blit_bgl: ?*wgpu.BindGroupLayout = null;
var g_blit_sampler: ?*wgpu.Sampler = null;
var g_blit_bind_group: ?*wgpu.BindGroup = null;
var g_blit_bound_view: ?*wgpu.TextureView = null;

pub fn isOpen() bool {
    return g_window != null;
}

/// Open the pop-out (or RELOAD it when already open — the Compile-button
/// case: same window, fresh gamefile). Width/height are the initial window
/// size; the user resizes from there.
pub fn open(io: std.Io, environ: *const std.process.Environ.Map, game_file: []const u8, store_dir: []const u8, width: u32, height: u32) !void {
    if (g_window != null) {
        // reload: drop the runtime, keep the window + swapchain
        world_loader.unmount(io, WINDOW_NODE_ID);
        try world_loader.mount(io, environ, std.heap.c_allocator, WINDOW_NODE_ID, game_file, store_dir);
        if (g_window) |w| _ = c.SDL_RaiseWindow(w);
        return;
    }

    const w = c.SDL_CreateWindow("hmsc · compiled world", @intCast(@max(320, width)), @intCast(@max(240, height)), c.SDL_WINDOW_RESIZABLE) orelse {
        log.print("[world-window] SDL_CreateWindow failed\n", .{});
        return error.WindowFailed;
    };
    errdefer c.SDL_DestroyWindow(w);

    const surface = gpu.createWindowSurface(w) orelse {
        log.print("[world-window] surface creation failed\n", .{});
        return error.SurfaceFailed;
    };
    errdefer surface.release();

    var pw: c_int = 0;
    var ph: c_int = 0;
    _ = c.SDL_GetWindowSizeInPixels(w, &pw, &ph);
    g_width = @intCast(@max(1, pw));
    g_height = @intCast(@max(1, ph));
    g_surface_format = gpu.configureExtraSurface(surface, g_width, g_height) orelse {
        log.print("[world-window] surface configure failed\n", .{});
        return error.SurfaceFailed;
    };

    try world_loader.mount(io, environ, std.heap.c_allocator, WINDOW_NODE_ID, game_file, store_dir);

    g_window = w;
    g_window_id = c.SDL_GetWindowID(w);
    g_surface = surface;
    g_mouse_captured = false;
    g_aiming = false;
    log.print("[world-window] open {d}x{d} (click to capture the mouse, Esc releases)\n", .{ g_width, g_height });
}

pub fn close(io: std.Io) void {
    if (g_window == null) return;
    world_loader.unmount(io, WINDOW_NODE_ID);
    releaseBlitBindGroup();
    g_target.deinit();
    if (g_surface) |s| {
        s.unconfigure();
        s.release();
    }
    g_surface = null;
    if (g_window) |w| c.SDL_DestroyWindow(w);
    g_window = null;
    g_window_id = 0;
    g_mouse_captured = false;
    g_aiming = false;
    log.print("[world-window] closed\n", .{});
}

/// Engine-exit teardown (pipeline objects included).
pub fn deinitAll(io: std.Io) void {
    close(io);
    if (g_blit_pipeline) |p| p.release();
    g_blit_pipeline = null;
    if (g_blit_bgl) |l| l.release();
    g_blit_bgl = null;
    if (g_blit_sampler) |s| s.release();
    g_blit_sampler = null;
}

fn releaseBlitBindGroup() void {
    if (g_blit_bind_group) |bg| bg.release();
    g_blit_bind_group = null;
    g_blit_bound_view = null;
}

fn setMouseCaptured(captured: bool) void {
    const w = g_window orelse return;
    _ = c.SDL_SetWindowRelativeMouseMode(w, captured);
    g_mouse_captured = captured;
}

/// Route one SDL event. Returns true when the event belonged to this window
/// (consumed — the main window must not also act on it).
pub fn routeEvent(io: std.Io, event: *const c.SDL_Event) bool {
    if (g_window == null) return false;
    switch (event.type) {
        c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => {
            if (event.window.windowID != g_window_id) return false;
            close(io);
            return true;
        },
        c.SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED => {
            if (event.window.windowID != g_window_id) return false;
            const w = g_window orelse return true;
            var pw: c_int = 0;
            var ph: c_int = 0;
            _ = c.SDL_GetWindowSizeInPixels(w, &pw, &ph);
            g_width = @intCast(@max(1, pw));
            g_height = @intCast(@max(1, ph));
            if (g_surface) |s| {
                g_surface_format = gpu.configureExtraSurface(s, g_width, g_height) orelse g_surface_format;
            }
            return true;
        },
        c.SDL_EVENT_WINDOW_FOCUS_LOST => {
            if (event.window.windowID != g_window_id) return false;
            if (g_mouse_captured) setMouseCaptured(false);
            return true;
        },
        c.SDL_EVENT_MOUSE_MOTION => {
            if (event.motion.windowID != g_window_id) return false;
            if (g_mouse_captured) world_loader.mouseLook(WINDOW_NODE_ID, event.motion.xrel, event.motion.yrel);
            return true;
        },
        c.SDL_EVENT_MOUSE_BUTTON_DOWN => {
            if (event.button.windowID != g_window_id) return false;
            if (event.button.button == c.SDL_BUTTON_LEFT and !g_mouse_captured) setMouseCaptured(true);
            if (event.button.button == c.SDL_BUTTON_RIGHT and g_mouse_captured) {
                world_loader.setAiming(WINDOW_NODE_ID, true);
                g_aiming = true;
            }
            return true;
        },
        c.SDL_EVENT_MOUSE_BUTTON_UP => {
            if (event.button.windowID != g_window_id) return false;
            if (event.button.button == c.SDL_BUTTON_RIGHT and g_aiming) {
                world_loader.setAiming(WINDOW_NODE_ID, false);
                g_aiming = false;
            }
            return true;
        },
        c.SDL_EVENT_MOUSE_WHEEL => {
            return event.wheel.windowID == g_window_id;
        },
        c.SDL_EVENT_KEY_DOWN => {
            if (event.key.windowID != g_window_id) return false;
            if (event.key.scancode == c.SDL_SCANCODE_ESCAPE and g_mouse_captured) setMouseCaptured(false);
            // consumed: movement reads process-wide key state; the editor's
            // hotkey contract must not fire while this window is focused
            return true;
        },
        c.SDL_EVENT_KEY_UP => {
            return event.key.windowID == g_window_id;
        },
        else => return false,
    }
}

fn ensureBlitPipeline(device: *wgpu.Device) bool {
    if (g_blit_pipeline != null and g_blit_pipeline_format == g_surface_format) return true;
    if (g_blit_pipeline) |p| p.release();
    g_blit_pipeline = null;

    if (g_blit_bgl == null) {
        const layout_entries = [_]wgpu.BindGroupLayoutEntry{
            .{
                .binding = 0,
                .visibility = wgpu.ShaderStages.fragment,
                .texture = .{ .sample_type = .float, .view_dimension = .@"2d", .multisampled = 0 },
            },
            .{
                .binding = 1,
                .visibility = wgpu.ShaderStages.fragment,
                .sampler = .{ .type = .filtering },
            },
        };
        g_blit_bgl = device.createBindGroupLayout(&.{
            .entry_count = layout_entries.len,
            .entries = &layout_entries,
        });
    }
    if (g_blit_sampler == null) {
        g_blit_sampler = device.createSampler(&.{
            .address_mode_u = .clamp_to_edge,
            .address_mode_v = .clamp_to_edge,
            .mag_filter = .linear,
            .min_filter = .linear,
        });
    }
    const bgl = g_blit_bgl orelse return false;
    if (g_blit_sampler == null) return false;

    const desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "world_window_blit", .code = blit_wgsl });
    const module = device.createShaderModule(&desc) orelse return false;
    defer module.release();

    const layouts = [_]?*wgpu.BindGroupLayout{bgl};
    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = layouts.len,
        .bind_group_layouts = @ptrCast(&layouts),
    }) orelse return false;
    defer pipeline_layout.release();

    const color_target = wgpu.ColorTargetState{
        .format = g_surface_format,
        .blend = null,
        .write_mask = wgpu.ColorWriteMasks.all,
    };
    const frag = wgpu.FragmentState{
        .module = module,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };
    g_blit_pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{ .module = module, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = 0 },
        .primitive = .{ .topology = .triangle_list, .cull_mode = .none, .front_face = .ccw },
        .depth_stencil = null,
        .multisample = .{},
        .fragment = &frag,
    });
    g_blit_pipeline_format = g_surface_format;
    return g_blit_pipeline != null;
}

/// One pop-out frame: step + render the world into the detached RT, then
/// blit it into this window's swapchain and present. Called from the engine
/// loop after the main gpu.frame(); fully self-contained otherwise.
pub fn frame(io: std.Io, environ: *const std.process.Environ.Map) void {
    if (g_window == null) return;
    const device = gpu.getDevice() orelse return;
    const queue = gpu.getQueue() orelse return;
    const surface = g_surface orelse return;

    const view = world_loader.renderDetachedView(
        io,
        environ,
        WINDOW_NODE_ID,
        &g_target,
        @floatFromInt(g_width),
        @floatFromInt(g_height),
    ) orelse return;

    if (!ensureBlitPipeline(device)) return;
    if (g_blit_bound_view != view) {
        releaseBlitBindGroup();
        const entries = [_]wgpu.BindGroupEntry{
            .{ .binding = 0, .texture_view = view },
            .{ .binding = 1, .sampler = g_blit_sampler.? },
        };
        g_blit_bind_group = device.createBindGroup(&.{
            .layout = g_blit_bgl.?,
            .entry_count = entries.len,
            .entries = &entries,
        });
        g_blit_bound_view = view;
    }
    const bind_group = g_blit_bind_group orelse return;

    var surface_texture: wgpu.SurfaceTexture = undefined;
    surface.getCurrentTexture(&surface_texture);
    if (surface_texture.status != .success_optimal and surface_texture.status != .success_suboptimal) {
        if (surface_texture.texture) |t| t.release();
        g_surface_format = gpu.configureExtraSurface(surface, g_width, g_height) orelse g_surface_format;
        return; // next frame draws into the fresh swapchain
    }
    const texture = surface_texture.texture orelse return;
    defer texture.release();
    const target_view = texture.createView(null) orelse return;
    defer target_view.release();

    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("world_window") }) orelse return;
    const pass = encoder.beginRenderPass(&.{
        .color_attachment_count = 1,
        .color_attachments = @ptrCast(&wgpu.ColorAttachment{
            .view = target_view,
            .load_op = .clear,
            .store_op = .store,
            .clear_value = .{ .r = 0.02, .g = 0.03, .b = 0.05, .a = 1.0 },
        }),
        .depth_stencil_attachment = null,
    }) orelse {
        encoder.release();
        return;
    };
    pass.setPipeline(g_blit_pipeline.?);
    pass.setBindGroup(0, bind_group, 0, null);
    pass.draw(3, 1, 0, 0);

    // Interaction HUD (PROPUSE req_0624): this runs AFTER the main gpu.frame()
    // reset the shared 2D batches, so they are empty and ours for the pass —
    // append the HUD prims, point the shared globals at THIS window's size,
    // draw them over the blitted world, then put both back (below). The 2D
    // pipelines target the main surface format; skip when the window's format
    // differs (drawing would trip wgpu validation).
    var hud_rects: u32 = 0;
    var hud_glyphs: u32 = 0;
    if (g_surface_format == gpu.getFormat()) {
        world_loader.drawHudForWindow(WINDOW_NODE_ID, @floatFromInt(g_width), @floatFromInt(g_height));
        hud_rects = @intCast(rects.count());
        hud_glyphs = @intCast(text.count());
        if (hud_rects > 0 or hud_glyphs > 0) {
            gpu.setGlobalsScreenSize(g_width, g_height);
            if (hud_rects > 0) {
                rects.upload(queue);
                rects.drawBatch(pass, 0, hud_rects);
            }
            if (hud_glyphs > 0) {
                text.upload(queue);
                text.drawBatch(pass, 0, hud_glyphs);
            }
        }
    }

    pass.end();
    pass.release();
    const command = encoder.finish(&.{ .label = wgpu.StringView.fromSlice("world_window_cmd") }) orelse {
        encoder.release();
        return;
    };
    encoder.release();
    queue.submit(&.{command});
    command.release();
    // Put the shared 2D state back for the next main editor frame: empty
    // batches (ours are drawn) and the main window's screen_size (the main
    // frame only rewrites globals when content changed — a leaked override
    // would mis-scale the whole editor).
    if (hud_rects > 0 or hud_glyphs > 0) {
        rects.reset();
        text.reset();
        gpu.restoreGlobalsScreenSize();
    }
    _ = surface.present();
}

/// Status line for the cart door: "closed" or the runtime's own status.
pub fn statusAlloc(allocator: std.mem.Allocator) ![]u8 {
    if (g_window == null) return try allocator.dupe(u8, "closed");
    return world_loader.statusAlloc(allocator, WINDOW_NODE_ID);
}
