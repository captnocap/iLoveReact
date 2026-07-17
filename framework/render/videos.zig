//! Video playback via libmpv OpenGL render API.
//!
//! Port of love2d/lua/videos.lua, adapted for wgpu (Vulkan backend).
//! Primary path: mpv renders to a private GL FBO via its OpenGL render API
//! (hardware video decode, GPU color space conversion), then glReadPixels
//! bridges the frame to a CPU buffer for wgpu texture upload.
//! Fallback: software renderer if GL context creation fails.
//!
//! Architecture (GL primary path):
//!   1. Hidden SDL2 window + dedicated OpenGL context (separate from wgpu/Vulkan)
//!   2. Per-source mpv instance with MPV_RENDER_API_TYPE_OPENGL
//!   3. Private FBO + texture per video (same pipeline as Lua version)
//!   4. glReadPixels → CPU buffer → queue.writeTexture() → wgpu textured quad
//!   5. FLIP_Y=1 for top-down output matching wgpu convention
//!
//! No GL state save/restore needed — dedicated context means mpv can trash
//! GL state freely. Only framebuffer binding matters for readback.
//!
//! Requires: libmpv-dev (apt install libmpv-dev)
//! Fallback: gracefully degrades if libmpv not installed.
//!
//! Status lifecycle per src: null → loading → ready | error

const std = @import("std");
const host_io = @import("../host_io.zig");
const log = @import("../diag/log.zig");
const builtin = @import("builtin");
const wgpu = @import("wgpu");
const c = @import("../c.zig").imports;
const gpu_core = @import("../gpu/gpu.zig");
const images = @import("../gpu/images.zig");

// ════════════════════════════════════════════════════════════════════════
// POSIX dynamic loading (libc — linked by build.zig)
// ════════════════════════════════════════════════════════════════════════

extern fn dlopen(filename: ?[*:0]const u8, flags: c_int) ?*anyopaque;
extern fn dlsym(handle: *anyopaque, symbol: [*:0]const u8) ?*anyopaque;
extern fn dlclose(handle: *anyopaque) c_int;

const RTLD_LAZY: c_int = 0x00001;
// RTLD_DEEPBIND isolates mpv's internal Lua 5.2 symbols. Linux-only.
// macOS uses two-level namespaces by default (equivalent isolation).
const RTLD_DEEPBIND: c_int = if (builtin.os.tag == .linux) 0x00008 else 0;

// ════════════════════════════════════════════════════════════════════════
// MPV constants
// ════════════════════════════════════════════════════════════════════════

const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;
const MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME: c_int = 12;
const MPV_RENDER_PARAM_SW_SIZE: c_int = 17;
const MPV_RENDER_PARAM_SW_FORMAT: c_int = 18;
const MPV_RENDER_PARAM_SW_STRIDE: c_int = 19;
const MPV_RENDER_PARAM_SW_POINTER: c_int = 20;
const MPV_RENDER_UPDATE_FRAME: u64 = 1;

const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;

// ════════════════════════════════════════════════════════════════════════
// GL constants (same set as Lua version)
// ════════════════════════════════════════════════════════════════════════

const GL_FRAMEBUFFER: c_uint = 0x8D40;
const GL_READ_FRAMEBUFFER: c_uint = 0x8CA8;
const GL_COLOR_ATTACHMENT0: c_uint = 0x8CE0;
const GL_FRAMEBUFFER_COMPLETE: c_uint = 0x8CD5;
const GL_TEXTURE_2D: c_uint = 0x0DE1;
const GL_RGBA8: c_int = 0x8058;
const GL_RGBA: c_uint = 0x1908;
const GL_UNSIGNED_BYTE: c_uint = 0x1401;
const GL_TEXTURE_MIN_FILTER: c_uint = 0x2801;
const GL_TEXTURE_MAG_FILTER: c_uint = 0x2800;
const GL_LINEAR: c_int = 0x2601;

// ════════════════════════════════════════════════════════════════════════
// MPV types
// ════════════════════════════════════════════════════════════════════════

const MpvRenderParam = extern struct {
    type: c_int = 0,
    data: ?*anyopaque = null,
};

const MpvOpenGLInitParams = extern struct {
    get_proc_address: *const fn (?*anyopaque, [*:0]const u8) callconv(.c) ?*anyopaque,
    get_proc_address_ctx: ?*anyopaque = null,
};

const MpvOpenGLFbo = extern struct {
    fbo: c_int = 0,
    w: c_int = 0,
    h: c_int = 0,
    internal_format: c_int = 0,
};

// ════════════════════════════════════════════════════════════════════════
// MPV function pointer types (loaded from libmpv at runtime)
// ════════════════════════════════════════════════════════════════════════

const FnCreate = *const fn () callconv(.c) ?*anyopaque;
const FnInitialize = *const fn (?*anyopaque) callconv(.c) c_int;
const FnSetOptionString = *const fn (?*anyopaque, [*:0]const u8, [*:0]const u8) callconv(.c) c_int;
const FnCommand = *const fn (?*anyopaque, [*]const ?[*:0]const u8) callconv(.c) c_int;
const FnTerminateDestroy = *const fn (?*anyopaque) callconv(.c) void;
const FnErrorString = *const fn (c_int) callconv(.c) [*:0]const u8;
const FnGetProperty = *const fn (?*anyopaque, [*:0]const u8, c_int, *anyopaque) callconv(.c) c_int;
const FnSetPropertyString = *const fn (?*anyopaque, [*:0]const u8, [*:0]const u8) callconv(.c) c_int;
const FnGetPropertyString = *const fn (?*anyopaque, [*:0]const u8) callconv(.c) ?[*:0]const u8;
const FnFree = *const fn (?*anyopaque) callconv(.c) void;
const FnRenderCtxCreate = *const fn (*?*anyopaque, ?*anyopaque, [*]MpvRenderParam) callconv(.c) c_int;
const FnRenderCtxRender = *const fn (?*anyopaque, [*]MpvRenderParam) callconv(.c) c_int;
const FnRenderCtxUpdate = *const fn (?*anyopaque) callconv(.c) u64;
const FnRenderCtxFree = *const fn (?*anyopaque) callconv(.c) void;
const FnRenderCtxReportSwap = *const fn (?*anyopaque) callconv(.c) void;

// ════════════════════════════════════════════════════════════════════════
// GL function pointer types (loaded via SDL_GL_GetProcAddress)
// ════════════════════════════════════════════════════════════════════════

const GlFunctions = struct {
    genFramebuffers: *const fn (c_int, *c_uint) callconv(.c) void = undefined,
    deleteFramebuffers: *const fn (c_int, *const c_uint) callconv(.c) void = undefined,
    bindFramebuffer: *const fn (c_uint, c_uint) callconv(.c) void = undefined,
    framebufferTexture2D: *const fn (c_uint, c_uint, c_uint, c_uint, c_int) callconv(.c) void = undefined,
    checkFramebufferStatus: *const fn (c_uint) callconv(.c) c_uint = undefined,
    genTextures: *const fn (c_int, *c_uint) callconv(.c) void = undefined,
    deleteTextures: *const fn (c_int, *const c_uint) callconv(.c) void = undefined,
    bindTexture: *const fn (c_uint, c_uint) callconv(.c) void = undefined,
    texImage2D: *const fn (c_uint, c_int, c_int, c_int, c_int, c_int, c_uint, c_uint, ?*const anyopaque) callconv(.c) void = undefined,
    texParameteri: *const fn (c_uint, c_uint, c_int) callconv(.c) void = undefined,
    readPixels: *const fn (c_int, c_int, c_int, c_int, c_uint, c_uint, ?*anyopaque) callconv(.c) void = undefined,
    pixelStorei: *const fn (c_uint, c_int) callconv(.c) void = undefined,
};

// ════════════════════════════════════════════════════════════════════════
// Loaded mpv function pointers
// ════════════════════════════════════════════════════════════════════════

const Mpv = struct {
    create: FnCreate = undefined,
    initialize: FnInitialize = undefined,
    set_option_string: FnSetOptionString = undefined,
    command: FnCommand = undefined,
    terminate_destroy: FnTerminateDestroy = undefined,
    error_string: FnErrorString = undefined,
    get_property: FnGetProperty = undefined,
    set_property_string: FnSetPropertyString = undefined,
    get_property_string: FnGetPropertyString = undefined,
    free: FnFree = undefined,
    render_ctx_create: FnRenderCtxCreate = undefined,
    render_ctx_render: FnRenderCtxRender = undefined,
    render_ctx_update: FnRenderCtxUpdate = undefined,
    render_ctx_free: FnRenderCtxFree = undefined,
    render_ctx_report_swap: FnRenderCtxReportSwap = undefined,
};

// ════════════════════════════════════════════════════════════════════════
// Module state
// ════════════════════════════════════════════════════════════════════════

var lib_handle: ?*anyopaque = null;
var mpv_fns: Mpv = .{};
var lib_available: bool = false;
var load_attempted: bool = false;

// GL context (shared by all videos — dedicated to mpv, separate from wgpu/Vulkan)
var gl_window: ?*c.SDL_Window = null;
var gl_context: c.SDL_GLContext = null;
var gl: GlFunctions = .{};
var gl_available: bool = false;

const RenderMode = enum { opengl, software };
var render_mode: RenderMode = .opengl;

const page_alloc = std.heap.page_allocator;

// ════════════════════════════════════════════════════════════════════════
// Per-source video entries
// ════════════════════════════════════════════════════════════════════════

pub const VideoStatus = enum { loading, ready, @"error" };

const MAX_VIDEOS = 8;
const UNLOAD_DEBOUNCE_FRAMES = 180; // ~3 seconds at 60fps

const VideoEntry = struct {
    src: []const u8 = "",
    active: bool = false,

    // mpv handles
    handle: ?*anyopaque = null,
    render_ctx: ?*anyopaque = null,

    // GL resources (opengl mode only)
    fbo: c_uint = 0,
    fbo_tex: c_uint = 0,

    // CPU pixel buffer (readback target)
    pixel_buf: ?[]u8 = null,
    width: u32 = 0,
    height: u32 = 0,

    // wgpu resources
    texture: ?*wgpu.Texture = null,
    texture_view: ?*wgpu.TextureView = null,
    sampler: ?*wgpu.Sampler = null,
    bind_group: ?*wgpu.BindGroup = null,

    // State
    status: VideoStatus = .loading,
    paused: bool = true,
    muted: bool = false,
    inactive_frames: u32 = 0,
    mode: RenderMode = .opengl,
};

var entries: [MAX_VIDEOS]VideoEntry = [_]VideoEntry{.{}} ** MAX_VIDEOS;
var _paint_logged: bool = false;
var entry_count: usize = 0;

// ════════════════════════════════════════════════════════════════════════
// GL context setup (dedicated hidden window for mpv rendering)
// ════════════════════════════════════════════════════════════════════════

/// mpv's get_proc_address callback — routes to SDL3's GL loader
fn glGetProcAddr(_: ?*anyopaque, name: [*:0]const u8) callconv(.c) ?*anyopaque {
    // SDL3: SDL_GL_GetProcAddress returns SDL_FunctionPointer, cast to void*
    const fp = c.SDL_GL_GetProcAddress(name) orelse return null;
    return @ptrFromInt(@intFromPtr(fp));
}

fn loadGlFn(comptime T: type, name: [*:0]const u8) ?T {
    const fp = c.SDL_GL_GetProcAddress(name) orelse return null;
    return @ptrFromInt(@intFromPtr(fp));
}

fn initGLContext() bool {
    // Create hidden SDL3 window with OpenGL support
    gl_window = c.SDL_CreateWindow(
        "mpv-gl",
        1,
        1,
        c.SDL_WINDOW_OPENGL | c.SDL_WINDOW_HIDDEN,
    ) orelse {
        log.print("[videos] failed to create GL window\n", .{});
        return false;
    };

    // Create GL context
    gl_context = c.SDL_GL_CreateContext(gl_window.?);
    if (gl_context == null) {
        log.print("[videos] failed to create GL context: {s}\n", .{c.SDL_GetError()});
        c.SDL_DestroyWindow(gl_window.?);
        gl_window = null;
        return false;
    }

    // Load GL function pointers
    gl.genFramebuffers = loadGlFn(@TypeOf(gl.genFramebuffers), "glGenFramebuffers") orelse return glInitFail("glGenFramebuffers");
    gl.deleteFramebuffers = loadGlFn(@TypeOf(gl.deleteFramebuffers), "glDeleteFramebuffers") orelse return glInitFail("glDeleteFramebuffers");
    gl.bindFramebuffer = loadGlFn(@TypeOf(gl.bindFramebuffer), "glBindFramebuffer") orelse return glInitFail("glBindFramebuffer");
    gl.framebufferTexture2D = loadGlFn(@TypeOf(gl.framebufferTexture2D), "glFramebufferTexture2D") orelse return glInitFail("glFramebufferTexture2D");
    gl.checkFramebufferStatus = loadGlFn(@TypeOf(gl.checkFramebufferStatus), "glCheckFramebufferStatus") orelse return glInitFail("glCheckFramebufferStatus");
    gl.genTextures = loadGlFn(@TypeOf(gl.genTextures), "glGenTextures") orelse return glInitFail("glGenTextures");
    gl.deleteTextures = loadGlFn(@TypeOf(gl.deleteTextures), "glDeleteTextures") orelse return glInitFail("glDeleteTextures");
    gl.bindTexture = loadGlFn(@TypeOf(gl.bindTexture), "glBindTexture") orelse return glInitFail("glBindTexture");
    gl.texImage2D = loadGlFn(@TypeOf(gl.texImage2D), "glTexImage2D") orelse return glInitFail("glTexImage2D");
    gl.texParameteri = loadGlFn(@TypeOf(gl.texParameteri), "glTexParameteri") orelse return glInitFail("glTexParameteri");
    gl.readPixels = loadGlFn(@TypeOf(gl.readPixels), "glReadPixels") orelse return glInitFail("glReadPixels");
    gl.pixelStorei = loadGlFn(@TypeOf(gl.pixelStorei), "glPixelStorei") orelse return glInitFail("glPixelStorei");

    gl_available = true;
    log.print("[videos] GL context ready (dedicated for mpv)\n", .{});
    return true;
}

fn glInitFail(name: [*:0]const u8) bool {
    log.print("[videos] failed to load GL function: {s}\n", .{std.mem.span(name)});
    deinitGLContext();
    return false;
}

fn deinitGLContext() void {
    if (gl_context != null) {
        _ = c.SDL_GL_DestroyContext(gl_context);
        gl_context = null;
    }
    if (gl_window) |w| {
        c.SDL_DestroyWindow(w);
        gl_window = null;
    }
    gl_available = false;
}

/// Make the dedicated GL context current for mpv operations.
fn makeGLCurrent() void {
    if (gl_window != null and gl_context != null) {
        _ = c.SDL_GL_MakeCurrent(gl_window.?, gl_context);
    }
}

/// Create a private GL FBO + texture for mpv to render into.
fn createPrivateFBO(w: u32, h: u32) struct { fbo: c_uint, tex: c_uint } {
    var tex: c_uint = 0;
    gl.genTextures(1, &tex);
    gl.bindTexture(GL_TEXTURE_2D, tex);
    gl.texImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, @intCast(w), @intCast(h), 0, GL_RGBA, GL_UNSIGNED_BYTE, null);
    gl.texParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    gl.texParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    gl.bindTexture(GL_TEXTURE_2D, 0);

    var fbo: c_uint = 0;
    gl.genFramebuffers(1, &fbo);
    gl.bindFramebuffer(GL_FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);

    const status = gl.checkFramebufferStatus(GL_FRAMEBUFFER);
    gl.bindFramebuffer(GL_FRAMEBUFFER, 0);

    if (status != GL_FRAMEBUFFER_COMPLETE) {
        log.print("[videos] private FBO incomplete (status=0x{x})\n", .{status});
        gl.deleteTextures(1, &tex);
        gl.deleteFramebuffers(1, &fbo);
        return .{ .fbo = 0, .tex = 0 };
    }

    return .{ .fbo = fbo, .tex = tex };
}

// ════════════════════════════════════════════════════════════════════════
// Library loading (lazy — deferred until first video is requested)
// ════════════════════════════════════════════════════════════════════════

fn lookupFn(comptime T: type, handle: *anyopaque, name: [*:0]const u8) ?T {
    const sym = dlsym(handle, name) orelse return null;
    return @ptrCast(@alignCast(sym));
}

/// Load libmpv on demand. Safe to call multiple times.
pub fn loadLibrary() bool {
    if (lib_available) return true;
    if (load_attempted) return false;
    load_attempted = true;

    const is_linux = builtin.os.tag == .linux;
    const flags = RTLD_LAZY | RTLD_DEEPBIND;

    const paths: []const [*:0]const u8 = if (is_linux)
        &.{ "libmpv.so.2", "libmpv.so" }
    else
        &.{ "libmpv.2.dylib", "libmpv.dylib", "/opt/homebrew/lib/libmpv.dylib", "/usr/local/lib/libmpv.dylib" };

    var handle: ?*anyopaque = null;
    for (paths) |path| {
        handle = dlopen(path, flags);
        if (handle != null) {
            log.print("[videos] libmpv loaded from {s}\n", .{std.mem.span(path)});
            break;
        }
    }
    const h = handle orelse {
        log.print("[videos] libmpv not available — install libmpv-dev for video playback\n", .{});
        return false;
    };
    lib_handle = h;

    mpv_fns.create = lookupFn(FnCreate, h, "mpv_create") orelse return loadFail("mpv_create");
    mpv_fns.initialize = lookupFn(FnInitialize, h, "mpv_initialize") orelse return loadFail("mpv_initialize");
    mpv_fns.set_option_string = lookupFn(FnSetOptionString, h, "mpv_set_option_string") orelse return loadFail("mpv_set_option_string");
    mpv_fns.command = lookupFn(FnCommand, h, "mpv_command") orelse return loadFail("mpv_command");
    mpv_fns.terminate_destroy = lookupFn(FnTerminateDestroy, h, "mpv_terminate_destroy") orelse return loadFail("mpv_terminate_destroy");
    mpv_fns.error_string = lookupFn(FnErrorString, h, "mpv_error_string") orelse return loadFail("mpv_error_string");
    mpv_fns.get_property = lookupFn(FnGetProperty, h, "mpv_get_property") orelse return loadFail("mpv_get_property");
    mpv_fns.set_property_string = lookupFn(FnSetPropertyString, h, "mpv_set_property_string") orelse return loadFail("mpv_set_property_string");
    mpv_fns.get_property_string = lookupFn(FnGetPropertyString, h, "mpv_get_property_string") orelse return loadFail("mpv_get_property_string");
    mpv_fns.free = lookupFn(FnFree, h, "mpv_free") orelse return loadFail("mpv_free");
    mpv_fns.render_ctx_create = lookupFn(FnRenderCtxCreate, h, "mpv_render_context_create") orelse return loadFail("mpv_render_context_create");
    mpv_fns.render_ctx_render = lookupFn(FnRenderCtxRender, h, "mpv_render_context_render") orelse return loadFail("mpv_render_context_render");
    mpv_fns.render_ctx_update = lookupFn(FnRenderCtxUpdate, h, "mpv_render_context_update") orelse return loadFail("mpv_render_context_update");
    mpv_fns.render_ctx_free = lookupFn(FnRenderCtxFree, h, "mpv_render_context_free") orelse return loadFail("mpv_render_context_free");
    mpv_fns.render_ctx_report_swap = lookupFn(FnRenderCtxReportSwap, h, "mpv_render_context_report_swap") orelse return loadFail("mpv_render_context_report_swap");

    // Try to set up GL context (primary path). Fall back to SW if it fails.
    if (initGLContext()) {
        render_mode = .opengl;
        log.print("[videos] render mode: OpenGL (GPU-accelerated)\n", .{});
    } else {
        render_mode = .software;
        log.print("[videos] render mode: software (GL context failed, CPU fallback)\n", .{});
    }

    lib_available = true;
    return true;
}

fn loadFail(name: [*:0]const u8) bool {
    log.print("[videos] failed to load symbol: {s}\n", .{std.mem.span(name)});
    if (lib_handle) |h| _ = dlclose(h);
    lib_handle = null;
    return false;
}

/// Fully unload libmpv: destroy all videos, dlclose handle, reset flags.
pub fn unloadLibrary() void {
    if (!lib_available) return;
    log.print("[videos] unloadLibrary: tearing down mpv...\n", .{});

    clearCache();
    deinitGLContext();

    if (lib_handle) |h| {
        _ = dlclose(h);
        lib_handle = null;
    }

    lib_available = false;
    load_attempted = false;
    log.print("[videos] unloadLibrary: complete\n", .{});
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

fn getMpvDouble(handle: ?*anyopaque, name: [*:0]const u8) ?f64 {
    var val: f64 = 0;
    const err = mpv_fns.get_property(handle, name, MPV_FORMAT_DOUBLE, @ptrCast(&val));
    if (err >= 0) return val;
    return null;
}

fn getMpvInt(handle: ?*anyopaque, name: [*:0]const u8) ?i64 {
    var val: i64 = 0;
    const err = mpv_fns.get_property(handle, name, MPV_FORMAT_INT64, @ptrCast(&val));
    if (err >= 0) return val;
    return null;
}

fn isRemoteUrl(src: []const u8) bool {
    return std.mem.startsWith(u8, src, "http://") or std.mem.startsWith(u8, src, "https://");
}

fn findEntry(src: []const u8) ?*VideoEntry {
    for (entries[0..entry_count]) |*e| {
        if (std.mem.eql(u8, e.src, src)) return e;
    }
    return null;
}

// ════════════════════════════════════════════════════════════════════════
// Video loading (per-source mpv instances)
// ════════════════════════════════════════════════════════════════════════

fn loadVideo(src: []const u8) void {
    if (!loadLibrary()) return;
    if (entry_count >= MAX_VIDEOS) {
        log.print("[videos] max videos reached ({d})\n", .{MAX_VIDEOS});
        return;
    }

    log.print("[videos] loadVideo: {s}\n", .{src});

    const handle = mpv_fns.create() orelse {
        log.print("[videos] mpv_create failed\n", .{});
        entries[entry_count] = .{ .src = src, .status = .@"error" };
        entry_count += 1;
        return;
    };

    // Configure — same options as the Lua version
    _ = mpv_fns.set_option_string(handle, "vo", "libmpv");
    _ = mpv_fns.set_option_string(handle, "hwdec", if (render_mode == .opengl) "auto" else "no");
    _ = mpv_fns.set_option_string(handle, "load-scripts", "no");
    _ = mpv_fns.set_option_string(handle, "ytdl", "no");
    _ = mpv_fns.set_option_string(handle, "osd-level", "0");
    _ = mpv_fns.set_option_string(handle, "sub", "no");
    _ = mpv_fns.set_option_string(handle, "terminal", "yes");
    _ = mpv_fns.set_option_string(handle, "msg-level", "all=warn");
    _ = mpv_fns.set_option_string(handle, "keep-open", "yes");
    _ = mpv_fns.set_option_string(handle, "idle", "yes");
    _ = mpv_fns.set_option_string(handle, "input-default-bindings", "no");
    _ = mpv_fns.set_option_string(handle, "input-vo-keyboard", "no");
    _ = mpv_fns.set_option_string(handle, "pause", "yes");

    var err = mpv_fns.initialize(handle);
    if (err < 0) {
        log.print("[videos] mpv_initialize failed: {s}\n", .{std.mem.span(mpv_fns.error_string(err))});
        mpv_fns.terminate_destroy(handle);
        entries[entry_count] = .{ .src = src, .status = .@"error" };
        entry_count += 1;
        return;
    }

    // Create render context — OpenGL primary, SW fallback
    var render_ctx: ?*anyopaque = null;
    const entry_mode = createRenderContext(handle, &render_ctx);

    if (render_ctx == null) {
        log.print("[videos] render_context_create failed on both paths\n", .{});
        mpv_fns.terminate_destroy(handle);
        entries[entry_count] = .{ .src = src, .status = .@"error" };
        entry_count += 1;
        return;
    }

    // Load file
    var path_buf: [4096]u8 = undefined;
    if (src.len >= path_buf.len) {
        mpv_fns.render_ctx_free(render_ctx);
        mpv_fns.terminate_destroy(handle);
        entries[entry_count] = .{ .src = src, .status = .@"error" };
        entry_count += 1;
        return;
    }

    if (!isRemoteUrl(src)) {
        const f = std.Io.Dir.cwd().openFile(host_io.io(), src, .{}) catch {
            log.print("[videos] file not found: {s}\n", .{src});
            mpv_fns.render_ctx_free(render_ctx);
            mpv_fns.terminate_destroy(handle);
            entries[entry_count] = .{ .src = src, .status = .@"error" };
            entry_count += 1;
            return;
        };
        f.close(host_io.io());
    }

    @memcpy(path_buf[0..src.len], src);
    path_buf[src.len] = 0;
    const resolved: [*:0]const u8 = path_buf[0..src.len :0];

    var cmd = [_]?[*:0]const u8{ "loadfile", resolved, "replace", null };
    err = mpv_fns.command(handle, &cmd);
    if (err < 0) {
        log.print("[videos] loadfile failed: {s}\n", .{std.mem.span(mpv_fns.error_string(err))});
        mpv_fns.render_ctx_free(render_ctx);
        mpv_fns.terminate_destroy(handle);
        entries[entry_count] = .{ .src = src, .status = .@"error" };
        entry_count += 1;
        return;
    }

    entries[entry_count] = .{
        .src = src,
        .handle = handle,
        .render_ctx = render_ctx,
        .status = .loading,
        .active = true,
        .mode = entry_mode,
    };
    entry_count += 1;
    log.print("[videos] loading: {s} (mode={s})\n", .{ src, @tagName(entry_mode) });
}

/// Create mpv render context. Tries OpenGL first, falls back to software.
fn createRenderContext(handle: ?*anyopaque, out_ctx: *?*anyopaque) RenderMode {
    // Try OpenGL first
    if (gl_available) {
        makeGLCurrent();
        var gl_init = MpvOpenGLInitParams{
            .get_proc_address = &glGetProcAddr,
        };
        var api_type_gl: [6:0]u8 = "opengl".*;
        var create_params_gl = [_]MpvRenderParam{
            .{ .type = MPV_RENDER_PARAM_API_TYPE, .data = @ptrCast(&api_type_gl) },
            .{ .type = MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, .data = @ptrCast(&gl_init) },
            .{ .type = 0, .data = null },
        };

        const err = mpv_fns.render_ctx_create(out_ctx, handle, &create_params_gl);
        if (err >= 0 and out_ctx.* != null) {
            return .opengl;
        }
        log.print("[videos] GL render context failed ({s}), trying SW\n", .{std.mem.span(mpv_fns.error_string(err))});
    }

    // Fallback: software renderer
    var api_type_sw: [2:0]u8 = "sw".*;
    var create_params_sw = [_]MpvRenderParam{
        .{ .type = MPV_RENDER_PARAM_API_TYPE, .data = @ptrCast(&api_type_sw) },
        .{ .type = 0, .data = null },
    };

    const err = mpv_fns.render_ctx_create(out_ctx, handle, &create_params_sw);
    if (err >= 0 and out_ctx.* != null) {
        return .software;
    }
    log.print("[videos] SW render context also failed: {s}\n", .{std.mem.span(mpv_fns.error_string(err))});
    return .software;
}

// ════════════════════════════════════════════════════════════════════════
// Per-frame update — poll mpv, render frames, upload to wgpu
// ════════════════════════════════════════════════════════════════════════

/// Call once per frame before paint.
pub fn update() void {
    if (!lib_available) return;

    const device = gpu_core.getDevice() orelse return;
    const queue = gpu_core.getQueue() orelse return;

    // Make GL context current for all GL-mode videos
    var need_gl = false;
    for (entries[0..entry_count]) |e| {
        if (e.mode == .opengl and e.handle != null) {
            need_gl = true;
            break;
        }
    }
    if (need_gl and gl_available) makeGLCurrent();

    for (entries[0..entry_count]) |*e| {
        if (e.handle == null) continue;

        // Phase 1: Initialize texture + FBO for newly loaded videos
        if (e.status == .loading and e.texture == null) {
            const w_opt = getMpvInt(e.handle, "video-params/w");
            const h_opt = getMpvInt(e.handle, "video-params/h");
            const dw_opt = getMpvInt(e.handle, "video-params/dw");
            const dh_opt = getMpvInt(e.handle, "video-params/dh");
            const raw_w = getMpvInt(e.handle, "width");
            const raw_h = getMpvInt(e.handle, "height");
            if (w_opt) |w_i| {
                if (h_opt) |h_i| {
                    log.print("[videos] mpv dims: video-params/w={d} h={d} dw={?} dh={?} raw_w={?} raw_h={?}\n", .{ w_i, h_i, dw_opt, dh_opt, raw_w, raw_h });
                    const w: u32 = @intCast(@max(1, w_i));
                    const h: u32 = @intCast(@max(1, h_i));
                    if (initVideoResources(e, device, w, h)) {
                        e.status = .ready;
                        log.print("[videos] ready: {s} ({d}x{d}, {s})\n", .{ e.src, w, h, @tagName(e.mode) });
                        // Force-render first frame immediately (mpv fires RENDER_UPDATE_FRAME
                        // during loadVideo, before our first update() — we miss it for paused videos)
                        if (e.mode == .opengl) renderGL(e, queue) else renderSW(e, queue);
                        log.print("[videos] first frame rendered\n", .{});
                    } else {
                        e.status = .@"error";
                        log.print("[videos] failed to create resources for {s}\n", .{e.src});
                    }
                }
            }
        }

        // Phase 2: Render new frames
        if (e.status == .ready) {
            if (e.render_ctx) |ctx| {
                const flags = mpv_fns.render_ctx_update(ctx);
                if (flags & MPV_RENDER_UPDATE_FRAME != 0) {
                    if (e.mode == .opengl) {
                        renderGL(e, queue);
                    } else {
                        renderSW(e, queue);
                    }
                }
            }
        }
    }

    // Cleanup inactive entries
    var i: usize = 0;
    while (i < entry_count) {
        if (!entries[i].active) {
            entries[i].inactive_frames += 1;
            if (entries[i].inactive_frames >= UNLOAD_DEBOUNCE_FRAMES) {
                destroyEntry(&entries[i]);
                if (i < entry_count - 1) {
                    entries[i] = entries[entry_count - 1];
                }
                entry_count -= 1;
                continue;
            }
        }
        entries[i].active = false;
        i += 1;
    }
}

fn initVideoResources(e: *VideoEntry, device: *wgpu.Device, w: u32, h: u32) bool {
    const buf_size = @as(usize, w) * @as(usize, h) * 4;
    e.pixel_buf = page_alloc.alloc(u8, buf_size) catch return false;
    e.width = w;
    e.height = h;

    // Create private GL FBO for OpenGL mode
    if (e.mode == .opengl and gl_available) {
        const fbo_result = createPrivateFBO(w, h);
        if (fbo_result.fbo == 0) {
            page_alloc.free(e.pixel_buf.?);
            e.pixel_buf = null;
            return false;
        }
        e.fbo = fbo_result.fbo;
        e.fbo_tex = fbo_result.tex;
    }

    // Create wgpu texture (RGBA8)
    e.texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("video_frame"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return false;

    e.texture_view = (e.texture orelse return false).createView(null) orelse {
        e.texture.?.destroy();
        e.texture = null;
        return false;
    };

    e.sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
    }) orelse {
        e.texture_view.?.release();
        e.texture.?.destroy();
        e.texture_view = null;
        e.texture = null;
        return false;
    };

    e.bind_group = images.createBindGroup(e.texture_view.?, e.sampler.?) orelse {
        e.sampler.?.release();
        e.texture_view.?.release();
        e.texture.?.destroy();
        e.sampler = null;
        e.texture_view = null;
        e.texture = null;
        return false;
    };

    return true;
}

// ════════════════════════════════════════════════════════════════════════
// Frame rendering — OpenGL path (GPU-accelerated)
// ════════════════════════════════════════════════════════════════════════

fn renderGL(e: *VideoEntry, queue: *wgpu.Queue) void {
    const ctx = e.render_ctx orelse return;
    const buf = e.pixel_buf orelse return;
    const tex = e.texture orelse return;
    const w = e.width;
    const h = e.height;
    if (e.fbo == 0) return;

    // mpv renders to private FBO
    var mpv_fbo = MpvOpenGLFbo{
        .fbo = @intCast(e.fbo),
        .w = @intCast(w),
        .h = @intCast(h),
        .internal_format = 0,
    };
    var flip_y: c_int = 0; // GL convention bottom-up; shader UV.y flip handles it
    var block_time: c_int = 0; // don't block waiting for display refresh
    var render_params = [_]MpvRenderParam{
        .{ .type = MPV_RENDER_PARAM_OPENGL_FBO, .data = @ptrCast(&mpv_fbo) },
        .{ .type = MPV_RENDER_PARAM_FLIP_Y, .data = @ptrCast(&flip_y) },
        .{ .type = MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, .data = @ptrCast(&block_time) },
        .{ .type = 0, .data = null },
    };

    const err = mpv_fns.render_ctx_render(ctx, &render_params);
    if (err < 0) return;
    mpv_fns.render_ctx_report_swap(ctx);

    // Read back from private FBO to CPU buffer
    gl.pixelStorei(0x0D05, 1); // GL_PACK_ALIGNMENT = 1 (no row padding)
    gl.bindFramebuffer(GL_READ_FRAMEBUFFER, e.fbo);
    gl.readPixels(0, 0, @intCast(w), @intCast(h), GL_RGBA, GL_UNSIGNED_BYTE, @ptrCast(buf.ptr));
    gl.bindFramebuffer(GL_READ_FRAMEBUFFER, 0);

    // Flip rows vertically before upload.
    // glReadPixels from an FBO returns top-down data (FBO texture origin is top-left).
    // The shared image shader has UV Y-flip (1.0 - corner.y), so this CPU flip
    // cancels it → correct orientation. Same pattern as render_surfaces.zig.
    const row_bytes: usize = @as(usize, w) * 4;
    var top: usize = 0;
    var bot: usize = h - 1;
    while (top < bot) {
        const top_off = top * row_bytes;
        const bot_off = bot * row_bytes;
        var col: usize = 0;
        while (col < row_bytes) : (col += 1) {
            buf[top_off + col] ^= buf[bot_off + col];
            buf[bot_off + col] ^= buf[top_off + col];
            buf[top_off + col] ^= buf[bot_off + col];
        }
        top += 1;
        bot -= 1;
    }

    // Upload to wgpu texture
    uploadToWgpu(tex, buf, w, h, queue);
}

// ════════════════════════════════════════════════════════════════════════
// Frame rendering — Software fallback (CPU-only)
// ════════════════════════════════════════════════════════════════════════

fn renderSW(e: *VideoEntry, queue: *wgpu.Queue) void {
    const ctx = e.render_ctx orelse return;
    const buf = e.pixel_buf orelse return;
    const tex = e.texture orelse return;
    const w = e.width;
    const h = e.height;

    var sw_size = [2]c_int{ @intCast(w), @intCast(h) };
    var sw_format: [4:0]u8 = "rgb0".*;
    var sw_stride: usize = @as(usize, w) * 4;
    var block_time: c_int = 0;

    var render_params = [_]MpvRenderParam{
        .{ .type = MPV_RENDER_PARAM_SW_SIZE, .data = @ptrCast(&sw_size) },
        .{ .type = MPV_RENDER_PARAM_SW_FORMAT, .data = @ptrCast(&sw_format) },
        .{ .type = MPV_RENDER_PARAM_SW_STRIDE, .data = @ptrCast(&sw_stride) },
        .{ .type = MPV_RENDER_PARAM_SW_POINTER, .data = @ptrCast(buf.ptr) },
        .{ .type = MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, .data = @ptrCast(&block_time) },
        .{ .type = 0, .data = null },
    };

    const err = mpv_fns.render_ctx_render(ctx, &render_params);
    if (err < 0) return;
    mpv_fns.render_ctx_report_swap(ctx);

    // The shared image shader now respects texture alpha normally, so
    // software-decoded video frames need an explicit opaque alpha channel.
    var i: usize = 3;
    while (i < buf.len) : (i += 4) {
        buf[i] = 255;
    }

    uploadToWgpu(tex, buf, w, h, queue);
}

// ════════════════════════════════════════════════════════════════════════
// Shared: CPU buffer → wgpu texture upload
// ════════════════════════════════════════════════════════════════════════

fn uploadToWgpu(tex: *wgpu.Texture, buf: []u8, w: u32, h: u32, queue: *wgpu.Queue) void {
    queue.writeTexture(
        &.{
            .texture = tex,
            .mip_level = 0,
            .origin = .{ .x = 0, .y = 0, .z = 0 },
            .aspect = .all,
        },
        @ptrCast(buf.ptr),
        @as(usize, w) * @as(usize, h) * 4,
        &.{
            .offset = 0,
            .bytes_per_row = w * 4,
            .rows_per_image = h,
        },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
}

// ════════════════════════════════════════════════════════════════════════
// Paint-phase API (called from engine during node traversal)
// ════════════════════════════════════════════════════════════════════════

/// Called during paint when a node with video_src is encountered.
/// Ensures the video is loaded and queues the textured quad for rendering.
/// Returns true if a video quad was queued (caller should skip background paint).
pub fn paintVideo(src: []const u8, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    var entry = findEntry(src);
    if (entry == null) {
        loadVideo(src);
        entry = findEntry(src);
    }
    const e = entry orelse return false;
    e.active = true;

    if (e.status != .ready) return false;
    const bg = e.bind_group orelse return false;
    if (e.width == 0 or e.height == 0) return false;

    // Clamp container height to window bounds (layout can produce h=9999
    // from the proportional fallback on unconstrained flex containers).
    // Then aspect-ratio "contain" fit within the clamped rect.
    const win_h: f32 = @floatFromInt(gpu_core.getHeight());
    const ch = @min(h, win_h - y); // visible height from y to bottom of window
    const vid_w: f32 = @floatFromInt(e.width);
    const vid_h: f32 = @floatFromInt(e.height);
    const vid_aspect = vid_w / vid_h;
    const box_aspect = w / ch;
    var draw_w = w;
    var draw_h = ch;
    if (vid_aspect > box_aspect) {
        draw_h = w / vid_aspect;
    } else if (vid_aspect < box_aspect) {
        draw_w = ch * vid_aspect;
    }
    const draw_x = x + (w - draw_w) / 2;
    const draw_y = y + (ch - draw_h) / 2;

    if (!_paint_logged) {
        log.print("[videos] paintVideo: rect=({d:.0},{d:.0},{d:.0},{d:.0}) clamped_h={d:.0} vid={d}x{d} draw=({d:.0},{d:.0},{d:.0},{d:.0})\n", .{ x, y, w, h, ch, e.width, e.height, draw_x, draw_y, draw_w, draw_h });
        _paint_logged = true;
    }

    images.queueQuad(draw_x, draw_y, draw_w, draw_h, opacity, bg);
    return true;
}

/// Get the status of a video source.
pub fn getStatus(src: []const u8) ?VideoStatus {
    const e = findEntry(src) orelse return null;
    return e.status;
}

/// Get the intrinsic dimensions of a video.
pub fn getDimensions(src: []const u8) ?struct { w: u32, h: u32 } {
    const e = findEntry(src) orelse return null;
    if (e.width > 0 and e.height > 0) return .{ .w = e.width, .h = e.height };
    return null;
}

// ════════════════════════════════════════════════════════════════════════
// Playback control
// ════════════════════════════════════════════════════════════════════════

pub fn setPaused(src: []const u8, paused: bool) void {
    const e = findEntry(src) orelse return;
    if (e.handle) |h| {
        _ = mpv_fns.set_property_string(h, "pause", if (paused) "yes" else "no");
        e.paused = paused;
    }
}

pub fn setVolume(src: []const u8, volume: f32) void {
    const e = findEntry(src) orelse return;
    if (e.handle) |h| {
        var buf: [32]u8 = undefined;
        const vol_str = std.fmt.bufPrint(&buf, "{d:.0}", .{volume * 100}) catch return;
        buf[vol_str.len] = 0;
        _ = mpv_fns.set_property_string(h, "volume", buf[0..vol_str.len :0]);
    }
}

pub fn setMuted(src: []const u8, muted: bool) void {
    const e = findEntry(src) orelse return;
    if (e.handle) |h| {
        _ = mpv_fns.set_property_string(h, "mute", if (muted) "yes" else "no");
    }
}

pub fn setLoop(src: []const u8, loop: bool) void {
    const e = findEntry(src) orelse return;
    if (e.handle) |h| {
        _ = mpv_fns.set_property_string(h, "loop-file", if (loop) "inf" else "no");
    }
}

pub fn seek(src: []const u8, time: f64) void {
    const e = findEntry(src) orelse return;
    if (e.handle) |h| {
        var buf: [32]u8 = undefined;
        const time_str = std.fmt.bufPrint(&buf, "{d:.3}", .{time}) catch return;
        buf[time_str.len] = 0;
        const cmd = [_]?[*:0]const u8{ "seek", buf[0..time_str.len :0], "absolute", null };
        _ = mpv_fns.command(h, &cmd);
    }
}

/// Frame-accurate seek (mpv "absolute+exact"). Slower than the keyframe
/// `seek` above — use it for the authoritative settle on scrub release,
/// never for the per-motion stream while dragging (MEDIASLIDER-0705).
pub fn seekExact(src: []const u8, time: f64) void {
    const e = findEntry(src) orelse return;
    if (e.handle) |h| {
        var buf: [32]u8 = undefined;
        const time_str = std.fmt.bufPrint(&buf, "{d:.3}", .{time}) catch return;
        buf[time_str.len] = 0;
        const cmd = [_]?[*:0]const u8{ "seek", buf[0..time_str.len :0], "absolute+exact", null };
        _ = mpv_fns.command(h, &cmd);
    }
}

pub fn getCurrentTime(src: []const u8) ?f64 {
    const e = findEntry(src) orelse return null;
    if (e.handle) |h| return getMpvDouble(h, "time-pos");
    return null;
}

pub fn getDuration(src: []const u8) ?f64 {
    const e = findEntry(src) orelse return null;
    if (e.handle) |h| return getMpvDouble(h, "duration");
    return null;
}

pub fn getPaused(src: []const u8) bool {
    const e = findEntry(src) orelse return true;
    return e.paused;
}

// ════════════════════════════════════════════════════════════════════════
// Cleanup
// ════════════════════════════════════════════════════════════════════════

fn destroyEntry(e: *VideoEntry) void {
    log.print("[videos] destroyEntry: stopping playback...\n", .{});
    if (e.handle) |h| {
        _ = mpv_fns.set_property_string(h, "pause", "yes");
        var stop_cmd = [_]?[*:0]const u8{ "stop", null };
        _ = mpv_fns.command(h, &stop_cmd);
    }
    if (e.bind_group) |bg| bg.release();
    if (e.sampler) |s| s.release();
    if (e.texture_view) |v| v.release();
    if (e.texture) |t| t.destroy();
    // GL context must be current for render_ctx_free and FBO cleanup
    if (e.mode == .opengl and gl_available) makeGLCurrent();
    if (e.fbo != 0 and gl_available) {
        var fbo = e.fbo;
        var tex = e.fbo_tex;
        gl.deleteFramebuffers(1, &fbo);
        gl.deleteTextures(1, &tex);
    }
    log.print("[videos] destroyEntry: freeing render ctx...\n", .{});
    if (e.render_ctx) |ctx| mpv_fns.render_ctx_free(ctx);
    log.print("[videos] destroyEntry: render ctx freed, calling terminate_destroy...\n", .{});
    if (e.handle) |h| mpv_fns.terminate_destroy(h);
    log.print("[videos] destroyEntry: terminate_destroy done\n", .{});
    if (e.pixel_buf) |buf| page_alloc.free(buf);
    e.* = .{};
    log.print("[videos] destroyEntry: complete\n", .{});
}

fn clearCache() void {
    for (entries[0..entry_count]) |*e| {
        destroyEntry(e);
    }
    entry_count = 0;
}

pub fn deinit() void {
    unloadLibrary();
}

// ════════════════════════════════════════════════════════════════════════
// File drop subscriber — registered via the generic filedrop system
// ════════════════════════════════════════════════════════════════════════

const filedrop = @import("../fs/filedrop.zig");
const Node = @import("../layout.zig").Node;

/// Subscribe to file drop events. Called once at engine startup.
pub fn init() void {
    filedrop.subscribe(&onFileDrop);
}

/// File drop handler — loads dropped file as video, auto-plays.
/// If libmpv isn't loaded yet, loadLibrary() is called on demand.
fn onFileDrop(path: []const u8, root: *Node) void {
    if (!loadLibrary()) return;

    log.print("[videos] file drop: {s}\n", .{path});

    // Destroy all existing videos and load the new one
    clearCache();
    loadVideo(path);

    // Auto-play
    if (findEntry(path)) |e| {
        if (e.handle) |h| {
            _ = mpv_fns.set_property_string(h, "pause", "no");
            e.paused = false;
        }
    }

    // Rewrite video_src on all Video nodes so paint picks up the new source
    patchVideoNodes(root, path);
}

fn patchVideoNodes(node: *Node, path: []const u8) void {
    if (node.video_src != null) {
        node.video_src = path;
    }
    for (node.children) |*child| {
        patchVideoNodes(child, path);
    }
}

/// Return count of loaded videos.
pub fn videoCount() usize {
    return entry_count;
}

/// Find any video that is ready (for keyboard routing).
fn findAnyReady() ?*VideoEntry {
    for (entries[0..entry_count]) |*e| {
        if (e.status == .ready and e.handle != null) return e;
    }
    return null;
}

/// Handle a key press for video playback. Returns true if consumed.
/// Space: play/pause, Left/Right: seek ±5s, Up/Down: volume ±5, M: mute
pub fn handleKey(sym: c_int) bool {
    const e = findAnyReady() orelse return false;
    if (sym == c.SDLK_SPACE) {
        e.paused = !e.paused;
        if (e.handle) |h| _ = mpv_fns.set_property_string(h, "pause", if (e.paused) "yes" else "no");
        return true;
    } else if (sym == c.SDLK_LEFT) {
        seekRelative(e, -5.0);
        return true;
    } else if (sym == c.SDLK_RIGHT) {
        seekRelative(e, 5.0);
        return true;
    } else if (sym == c.SDLK_UP) {
        adjustVolume(e, 5);
        return true;
    } else if (sym == c.SDLK_DOWN) {
        adjustVolume(e, -5);
        return true;
    } else if (sym == c.SDLK_M) {
        e.muted = !e.muted;
        if (e.handle) |h| _ = mpv_fns.set_property_string(h, "mute", if (e.muted) "yes" else "no");
        return true;
    }
    return false;
}

fn seekRelative(e: *VideoEntry, delta: f64) void {
    if (e.handle) |h| {
        var buf: [32]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "{d:.1}", .{delta}) catch return;
        buf[s.len] = 0;
        var cmd = [_]?[*:0]const u8{ "seek", buf[0..s.len :0], "relative", null };
        _ = mpv_fns.command(h, &cmd);
    }
}

fn adjustVolume(e: *VideoEntry, delta: f64) void {
    if (e.handle) |h| {
        const cur = getMpvDouble(h, "volume") orelse 100;
        const nv = @max(0, @min(150, cur + delta));
        var buf: [32]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "{d:.0}", .{nv}) catch return;
        buf[s.len] = 0;
        _ = mpv_fns.set_property_string(h, "volume", buf[0..s.len :0]);
    }
}
