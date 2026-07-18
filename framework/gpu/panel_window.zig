//! framework/gpu/panel_window.zig — the EDITOR-PANEL POP-OUT WINDOW
//! (PANELWIN-0628, req_2035/2037/2038).
//!
//! A second OS window that renders an arbitrary 2D React SUBTREE (the hmsc-int
//! editor rail: PropertiesPanel + FacePainter + CatalogRail) with the full wgpu
//! pipeline — so it can live on a second monitor unconstrained by the editor's
//! 312px rail. This is `world_window.zig` generalized from the native 3D world
//! to a 2D React subtree:
//!
//!   - SAME wgpu instance + device. `gpu.createWindowSurface` reuses g_instance,
//!     `gpu.configureExtraSurface` reuses g_device — a sibling swapchain, NOT a
//!     new device (the recurring "second wgpu instance" worry does not arise).
//!   - The subtree is already in the ONE shared host_tree (it's a <Window> node),
//!     already excluded from the main window's paint, and re-materialized per
//!     frame by v8_app.materializeWindowRoot. engine renders that root into a 2D
//!     RT in the MAIN surface format (so the 2D pipelines, which target the main
//!     format, are valid), then this module BLITS that RT into the window's own
//!     swapchain (the blit is the only thing built against THIS surface's format,
//!     so a format mismatch is handled cleanly — same trick world_window uses).
//!   - Because the subtree's nodes carry their real reconciler ids in the shared
//!     tree, this window's mouse/keyboard events dispatch through the SAME
//!     __dispatchEvent path → shared editor React state, zero IPC.
//!
//! Driven from the engine loop: engine.zig calls routeEvent() in the SDL poll
//! loop and renderPanelWindow() (which paints the subtree into a gpu RT and then
//! calls blitView) after the main gpu.frame(). One window for now — the door is
//! open/close/size, not a window manager.

const std = @import("std");
const wgpu = @import("wgpu");
const c = @import("../c.zig").imports;
const gpu = @import("gpu.zig");

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
    \\    out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VsOut) -> @location(0) vec4f {
    \\    return textureSample(src_tex, src_samp, in.uv);
    \\}
;

// ── UI event hook ───────────────────────────────────────────────────────────
// engine installs these so this module can route the pop-out window's input
// into the shared event dispatch (hit-test the panel root, fire onPress/hover/
// scroll). Coordinates are window-local pixels (the panel root is laid out at
// 0,0,w,h, so window-local == panel space directly).
pub const EventHook = struct {
    hover: *const fn (context: *anyopaque, x: f32, y: f32) void,
    press: *const fn (context: *anyopaque, x: f32, y: f32, button: u8, down: bool) void,
    wheel: *const fn (context: *anyopaque, x: f32, y: f32, dx: f32, dy: f32) void,
};
var g_event_hook: ?EventHook = null;
pub fn setEventHook(h: EventHook) void {
    g_event_hook = h;
}

var g_window: ?*c.SDL_Window = null;
var g_window_id: u32 = 0;
var g_surface: ?*wgpu.Surface = null;
var g_surface_format: wgpu.TextureFormat = .bgra8_unorm;
var g_width: u32 = 0;
var g_height: u32 = 0;

// blit machinery — pipeline built lazily against the surface's format; the
// bind group recreates whenever the bound RT view identity changes (resize).
var g_blit_pipeline: ?*wgpu.RenderPipeline = null;
var g_blit_pipeline_format: wgpu.TextureFormat = .bgra8_unorm;
var g_blit_bgl: ?*wgpu.BindGroupLayout = null;
var g_blit_sampler: ?*wgpu.Sampler = null;
var g_blit_bind_group: ?*wgpu.BindGroup = null;
var g_blit_bound_view: ?*wgpu.TextureView = null;

pub fn isOpen() bool {
    return g_window != null;
}

pub fn size() [2]u32 {
    return .{ g_width, g_height };
}

/// Reconcile the wgpu surface + render dims with the OS window's ACTUAL pixel
/// size. Called every frame so resize/maximize self-heal even when the WM does
/// not deliver SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED during a live drag (which
/// otherwise leaves the swapchain at the old size → the WM tears/stretches the
/// stale frame and the window appears stuck at its launch size).
pub fn syncSize() void {
    const w = g_window orelse return;
    var pw: c_int = 0;
    var ph: c_int = 0;
    _ = c.SDL_GetWindowSizeInPixels(w, &pw, &ph);
    const nw: u32 = @intCast(@max(1, pw));
    const nh: u32 = @intCast(@max(1, ph));
    if (nw == g_width and nh == g_height) return;
    g_width = nw;
    g_height = nh;
    if (g_surface) |s| {
        g_surface_format = gpu.configureExtraSurface(s, g_width, g_height) orelse g_surface_format;
    }
}

/// Open the pop-out (or just raise it when already open). Width/height are the
/// initial size; the user resizes from there.
pub fn open(width: u32, height: u32) !void {
    if (g_window) |w| {
        _ = c.SDL_RaiseWindow(w);
        return;
    }

    const w = c.SDL_CreateWindow("hmsc · panel", @intCast(@max(320, width)), @intCast(@max(240, height)), c.SDL_WINDOW_RESIZABLE) orelse {
        return error.WindowFailed;
    };
    errdefer c.SDL_DestroyWindow(w);

    const surface = gpu.createWindowSurface(w) orelse {
        return error.SurfaceFailed;
    };
    errdefer surface.release();

    var pw: c_int = 0;
    var ph: c_int = 0;
    _ = c.SDL_GetWindowSizeInPixels(w, &pw, &ph);
    g_width = @intCast(@max(1, pw));
    g_height = @intCast(@max(1, ph));
    g_surface_format = gpu.configureExtraSurface(surface, g_width, g_height) orelse {
        return error.SurfaceFailed;
    };

    g_window = w;
    g_window_id = c.SDL_GetWindowID(w);
    g_surface = surface;
}

pub fn close() void {
    if (g_window == null) return;
    releaseBlitBindGroup();
    if (g_surface) |s| {
        s.unconfigure();
        s.release();
    }
    g_surface = null;
    if (g_window) |w| c.SDL_DestroyWindow(w);
    g_window = null;
    g_window_id = 0;
}

/// Engine-exit teardown (pipeline objects included).
pub fn deinitAll() void {
    close();
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

/// Route one SDL event. Returns true when the event belonged to this window
/// (consumed — the main window must not also act on it).
pub fn routeEvent(event: *const c.SDL_Event, context: *anyopaque) bool {
    if (g_window == null) return false;
    switch (event.type) {
        c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => {
            if (event.window.windowID != g_window_id) return false;
            close();
            // the cart re-docks the rail by polling __panel_window_status.
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
        c.SDL_EVENT_MOUSE_MOTION => {
            if (event.motion.windowID != g_window_id) return false;
            if (g_event_hook) |h| h.hover(context, event.motion.x, event.motion.y);
            return true;
        },
        c.SDL_EVENT_MOUSE_BUTTON_DOWN => {
            if (event.button.windowID != g_window_id) return false;
            if (g_event_hook) |h| h.press(context, event.button.x, event.button.y, event.button.button, true);
            return true;
        },
        c.SDL_EVENT_MOUSE_BUTTON_UP => {
            if (event.button.windowID != g_window_id) return false;
            if (g_event_hook) |h| h.press(context, event.button.x, event.button.y, event.button.button, false);
            return true;
        },
        c.SDL_EVENT_MOUSE_WHEEL => {
            if (event.wheel.windowID != g_window_id) return false;
            // SDL wheel events carry the pointer position in mouse_x/mouse_y.
            if (g_event_hook) |h| h.wheel(context, event.wheel.mouse_x, event.wheel.mouse_y, event.wheel.x, event.wheel.y);
            return true;
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

    const desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "panel_window_blit", .code = blit_wgsl });
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

/// Blit a finished 2D RT (rendered by the engine into the MAIN surface format)
/// into this window's swapchain and present. Called from engine after the panel
/// subtree has been painted into `view`.
pub fn blitView(view: *wgpu.TextureView) void {
    if (g_window == null) return;
    const device = gpu.getDevice() orelse return;
    const surface = g_surface orelse return;

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

    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("panel_window") }) orelse return;
    const pass = encoder.beginRenderPass(&.{
        .color_attachment_count = 1,
        .color_attachments = @ptrCast(&wgpu.ColorAttachment{
            .view = target_view,
            .load_op = .clear,
            .store_op = .store,
            .clear_value = .{ .r = 0.04, .g = 0.07, .b = 0.12, .a = 1.0 },
        }),
        .depth_stencil_attachment = null,
    }) orelse {
        encoder.release();
        return;
    };
    pass.setPipeline(g_blit_pipeline.?);
    pass.setBindGroup(0, bind_group, 0, null);
    pass.draw(3, 1, 0, 0);
    pass.end();
    pass.release();

    const command = encoder.finish(&.{ .label = wgpu.StringView.fromSlice("panel_window_cmd") }) orelse {
        encoder.release();
        return;
    };
    encoder.release();
    const queue = gpu.getQueue() orelse return;
    queue.submit(&.{command});
    command.release();
    _ = surface.present();
}
