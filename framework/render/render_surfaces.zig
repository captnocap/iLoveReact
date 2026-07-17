//! Render surfaces — external display capture, virtual displays, VM rendering.
//!
//! Port of love2d/lua/render_source.lua + capabilities/render.lua.
//! Captures external pixel sources and renders them as textured quads in wgpu.
//!
//! Source types (parsed from string):
//!   "screen:0"           — Screen capture via X11/XShm (<1ms for 1080p)
//!   "cam:0"              — Webcam via FFmpeg/v4l2
//!   "hdmi:0"             — HDMI capture card via FFmpeg/v4l2
//!   "window:Firefox"     — Window capture via XShm (composited)
//!   "display"            — Virtual display (Xvfb/Xephyr + XShm capture)
//!   "vm:disk.qcow2"      — Boot VM via QEMU, capture via VNC
//!   "debian.iso"         — Auto-detect VM from file extension
//!   "vnc:host:port"      — Direct VNC connection
//!   "monitor:Name"       — Virtual monitor via xrandr + XShm
//!   "/dev/video0"        — Direct v4l2 device
//!
//! Architecture:
//!   1. parseSource() → SourceType enum + metadata
//!   2. Per-source Feed struct with backend-specific state
//!   3. update() polls backends for new RGBA frames
//!   4. paintSurface() uploads frame to wgpu texture, queues textured quad
//!
//! Integration: same pattern as videos.zig — node.render_src drives paint.

const std = @import("std");
const builtin = @import("builtin");
const host_io = @import("../host_io.zig");
const wgpu = @import("wgpu");
const c = @import("../c.zig").imports;
const gpu_core = @import("../gpu/gpu.zig");
const images = @import("../gpu/images.zig");
const log = @import("../diag/log.zig");
pub const vm = @import("render_surfaces_vm.zig");

const page_alloc = std.heap.page_allocator;
const posix = @import("../net/sysx.zig");

// ════════════════════════════════════════════════════════════════════════
// X11/XShm FFI declarations
// ════════════════════════════════════════════════════════════════════════

pub const Display = opaque {};
const Visual = opaque {};
pub const XID = c_ulong;

const XImage = extern struct {
    width: c_int,
    height: c_int,
    xoffset: c_int,
    format: c_int,
    data: ?[*]u8,
    byte_order: c_int,
    bitmap_unit: c_int,
    bitmap_bit_order: c_int,
    bitmap_pad: c_int,
    depth: c_int,
    bytes_per_line: c_int,
    bits_per_pixel: c_int,
    red_mask: c_ulong,
    green_mask: c_ulong,
    blue_mask: c_ulong,
    obdata: ?*anyopaque,
    // function pointers — opaque, we don't call them
    f_create_image: ?*anyopaque,
    f_destroy_image: ?*anyopaque,
    f_get_pixel: ?*anyopaque,
    f_put_pixel: ?*anyopaque,
    f_sub_image: ?*anyopaque,
    f_add_pixel: ?*anyopaque,
};

const XShmSegmentInfo = extern struct {
    shmseg: c_ulong,
    shmid: c_int,
    shmaddr: ?[*]u8,
    read_only: c_int,
};

// X11 constants
const ZPixmap: c_int = 2;
const AllPlanes: c_ulong = 0xFFFFFFFF;

// POSIX shared memory constants
const IPC_PRIVATE: c_int = 0;
const IPC_RMID: c_int = 0;
const IPC_CREAT: c_int = 512;

// XErrorEvent — passed to our protocol-error handler so we can log and continue
// instead of letting Xlib's default handler call exit(). Layout matches Xlib.
const XErrorEvent = extern struct {
    type: c_int,
    display: ?*Display,
    serial: c_ulong,
    error_code: u8,
    request_code: u8,
    minor_code: u8,
    resourceid: XID,
};

const XErrorHandlerFn = *const fn (?*Display, ?*XErrorEvent) callconv(.c) c_int;
const XIOErrorHandlerFn = *const fn (?*Display) callconv(.c) c_int;

// X11 function pointers (loaded at runtime via dlopen)
pub const X11Fns = struct {
    XOpenDisplay: *const fn (?[*:0]const u8) callconv(.c) ?*Display = undefined,
    XCloseDisplay: *const fn (*Display) callconv(.c) c_int = undefined,
    XDefaultRootWindow: *const fn (*Display) callconv(.c) XID = undefined,
    XDefaultScreen: *const fn (*Display) callconv(.c) c_int = undefined,
    XDefaultVisual: *const fn (*Display, c_int) callconv(.c) ?*Visual = undefined,
    XDefaultDepth: *const fn (*Display, c_int) callconv(.c) c_int = undefined,
    XDisplayWidth: *const fn (*Display, c_int) callconv(.c) c_int = undefined,
    XDisplayHeight: *const fn (*Display, c_int) callconv(.c) c_int = undefined,
    XFree: *const fn (?*anyopaque) callconv(.c) c_int = undefined,
    XFlush: *const fn (*Display) callconv(.c) c_int = undefined,
    XWarpPointer: *const fn (*Display, XID, XID, c_int, c_int, c_uint, c_uint, c_int, c_int) callconv(.c) c_int = undefined,
    XKeysymToKeycode: *const fn (*Display, c_ulong) callconv(.c) u8 = undefined,
    // Error handlers — install once so a single feed's X protocol/IO error
    // can't take down the whole process via Xlib's default exit() handlers.
    XSetErrorHandler: *const fn (?XErrorHandlerFn) callconv(.c) ?*anyopaque = undefined,
    XSetIOErrorHandler: *const fn (?XIOErrorHandlerFn) callconv(.c) ?*anyopaque = undefined,
};

// XTest extension function pointers (for synthetic input — no subprocess overhead)
pub const XTestFns = struct {
    XTestFakeKeyEvent: *const fn (*Display, c_uint, c_int, c_ulong) callconv(.c) c_int = undefined,
    XTestFakeButtonEvent: *const fn (*Display, c_uint, c_int, c_ulong) callconv(.c) c_int = undefined,
    XTestFakeMotionEvent: *const fn (*Display, c_int, c_int, c_int, c_ulong) callconv(.c) c_int = undefined,
};

const XExtFns = struct {
    XShmQueryExtension: *const fn (*Display) callconv(.c) c_int = undefined,
    XShmCreateImage: *const fn (*Display, ?*Visual, c_uint, c_int, ?[*]u8, *XShmSegmentInfo, c_uint, c_uint) callconv(.c) ?*XImage = undefined,
    XShmAttach: *const fn (*Display, *XShmSegmentInfo) callconv(.c) c_int = undefined,
    XShmDetach: *const fn (*Display, *XShmSegmentInfo) callconv(.c) c_int = undefined,
    XShmGetImage: *const fn (*Display, XID, *XImage, c_int, c_int, c_ulong) callconv(.c) c_int = undefined,
};

// POSIX shm (libc — linked by build.zig)
extern fn shmget(key: c_int, size: usize, shmflg: c_int) c_int;
extern fn shmat(shmid: c_int, shmaddr: ?*anyopaque, shmflg: c_int) ?*anyopaque;
extern fn shmdt(shmaddr: *anyopaque) c_int;
extern fn shmctl(shmid: c_int, cmd: c_int, buf: ?*anyopaque) c_int;

// POSIX fcntl — use the Linux syscall directly (libc fcntl is variadic, can't extern it cleanly)
const linux = std.os.linux;

pub fn setNonBlocking(fd: posix.fd_t) void {
    // F_GETFL=3, F_SETFL=4, O_NONBLOCK=0x800 on Linux
    const flags = linux.fcntl(fd, 3, 0); // F_GETFL
    if (@as(isize, @bitCast(flags)) < 0) return;
    _ = linux.fcntl(fd, 4, flags | 0x800); // F_SETFL | O_NONBLOCK
}

// ════════════════════════════════════════════════════════════════════════
// Module state
// ════════════════════════════════════════════════════════════════════════

var x11_lib: ?*anyopaque = null;
var xext_lib: ?*anyopaque = null;
var xtst_lib: ?*anyopaque = null;
var x11: X11Fns = .{};
var xext: XExtFns = .{};
var xtst: XTestFns = .{};
var xshm_available: bool = false;
pub var xtest_available: bool = false;
var x11_load_attempted: bool = false;

pub fn getX11() X11Fns {
    return x11;
}
pub fn getXtst() XTestFns {
    return xtst;
}

// Shared X11 display connection (dedicated for capture)
var x_display: ?*Display = null;
var x_root: XID = 0;
var x_screen: c_int = 0;

// ════════════════════════════════════════════════════════════════════════
// Source type parsing
// ════════════════════════════════════════════════════════════════════════

pub const SourceType = enum {
    screen,
    cam,
    hdmi,
    v4l2,
    window,
    display,
    vm,
    vnc_direct,
    monitor,
    unknown,
};

pub const ParsedSource = struct {
    source_type: SourceType = .unknown,
    index: u32 = 0,
    device: ?[]const u8 = null,
    title: ?[]const u8 = null,
    path: ?[]const u8 = null,
    host: ?[]const u8 = null,
    port: u16 = 0,
    name: ?[]const u8 = null,
    resolution: ?[]const u8 = null,
    command: ?[]const u8 = null, // app to launch into virtual display
};

const VM_EXTENSIONS = [_][]const u8{ "iso", "img", "qcow2", "qcow", "vmdk", "vdi", "vhd" };

pub fn parseSource(source: []const u8) ParsedSource {
    if (source.len == 0) return .{};

    if (std.mem.eql(u8, source, "self") or std.mem.eql(u8, source, "display")) {
        return .{ .source_type = .display };
    }
    if (std.mem.startsWith(u8, source, "display:")) {
        return .{ .source_type = .display, .resolution = source[8..] };
    }
    // app:command — launch command in virtual display
    if (std.mem.startsWith(u8, source, "app:")) {
        return .{ .source_type = .display, .command = source[4..] };
    }
    if (std.mem.startsWith(u8, source, "vnc:")) {
        const rest = source[4..];
        if (std.mem.lastIndexOfScalar(u8, rest, ':')) |colon| {
            const port = std.fmt.parseInt(u16, rest[colon + 1 ..], 10) catch 0;
            if (port > 0) return .{ .source_type = .vnc_direct, .host = rest[0..colon], .port = port };
        }
        return .{};
    }
    if (std.mem.startsWith(u8, source, "vm:")) {
        return .{ .source_type = .vm, .path = source[3..] };
    }
    if (std.mem.startsWith(u8, source, "monitor:")) {
        return .{ .source_type = .monitor, .name = source[8..] };
    }
    if (std.mem.startsWith(u8, source, "screen:")) {
        const idx = std.fmt.parseInt(u32, source[7..], 10) catch 0;
        return .{ .source_type = .screen, .index = idx };
    }
    if (std.mem.startsWith(u8, source, "cam:")) {
        const idx = std.fmt.parseInt(u32, source[4..], 10) catch 0;
        return .{ .source_type = .cam, .index = idx };
    }
    if (std.mem.startsWith(u8, source, "hdmi:")) {
        const idx = std.fmt.parseInt(u32, source[5..], 10) catch 0;
        return .{ .source_type = .hdmi, .index = idx };
    }
    if (std.mem.startsWith(u8, source, "window:")) {
        return .{ .source_type = .window, .title = source[7..] };
    }
    if (std.mem.startsWith(u8, source, "/dev/video")) {
        return .{ .source_type = .v4l2, .device = source };
    }
    if (std.mem.lastIndexOfScalar(u8, source, '.')) |dot| {
        const ext = source[dot + 1 ..];
        for (VM_EXTENSIONS) |vm_ext| {
            if (std.ascii.eqlIgnoreCase(ext, vm_ext)) {
                return .{ .source_type = .vm, .path = source };
            }
        }
    }
    return .{};
}

// ════════════════════════════════════════════════════════════════════════
// Backend enum
// ════════════════════════════════════════════════════════════════════════

const Backend = enum {
    xshm,
    ffmpeg,
    vnc,
    display_xshm,
};

// ════════════════════════════════════════════════════════════════════════
// Feed — per-source capture state
// ════════════════════════════════════════════════════════════════════════

pub const FeedStatus = enum { starting, connecting, ready, @"error", stopped };

pub const MAX_FEEDS = 64; // perf-lab headroom: pile on capture surfaces til the GPU/CPU wall, not an array cap
const UNLOAD_DEBOUNCE_FRAMES = 180; // ~3s at 60fps

pub const Feed = struct {
    source: []const u8 = "",
    parsed: ParsedSource = .{},
    backend: Backend = .xshm,
    status: FeedStatus = .starting,
    active: bool = false,
    inactive_frames: u32 = 0,

    // Capture dimensions
    width: u32 = 0,
    height: u32 = 0,

    // CPU pixel buffer (RGBA)
    pixel_buf: ?[]u8 = null,
    dirty: bool = false,

    // wgpu resources
    texture: ?*wgpu.Texture = null,
    texture_view: ?*wgpu.TextureView = null,
    sampler: ?*wgpu.Sampler = null,
    bind_group: ?*wgpu.BindGroup = null,

    // XShm state
    xshm_image: ?*XImage = null,
    xshm_info: XShmSegmentInfo = .{ .shmseg = 0, .shmid = -1, .shmaddr = null, .read_only = 0 },
    capture_ox: c_int = 0,
    capture_oy: c_int = 0,
    display_dpy: ?*Display = null,
    display_root: XID = 0,

    // FFmpeg subprocess state
    ffmpeg_child: ?std.process.Child = null,
    ffmpeg_stdout: ?std.Io.File = null,
    ffmpeg_read_offset: usize = 0, // partial frame read progress

    // VNC state
    vnc_socket: ?posix.socket_t = null,
    vnc_state: VncState = .not_connected,
    vnc_fb_width: u16 = 0,
    vnc_fb_height: u16 = 0,
    vnc_read_buf: [4096]u8 = undefined,

    // Process management
    qemu_child: ?std.process.Child = null,
    x_server_child: ?std.process.Child = null,
    app_child: ?std.process.Child = null, // app launched into virtual display
    display_num: ?u32 = null,
    vnc_port: u16 = 0,
    startup_wait: u32 = 0, // frames to wait for process startup
    app_command: ?[]const u8 = null, // command to launch after display is ready

    // Interactive mode
    interactive: bool = false,

    // Suspension. When true, all spawned subprocesses (qemu, Xvfb, the
    // app launched into Xvfb) have been SIGSTOPped — zero CPU, frozen
    // state. Last-rendered pixels stay on the texture so paint still
    // works. Toggling back to false SIGCONTs them — instant resume.
    suspended: bool = false,

    // One-shot diagnostic flags (printed once per feed lifetime)
    diag_first_frame_logged: bool = false,
    diag_first_paint_logged: bool = false,
    diag_first_upload_logged: bool = false,

    // VNC request flow control. We MUST NOT issue a new framebuffer-update
    // request before the previous response is fully consumed — otherwise
    // qemu generates 60 full-screen RGBA responses per second (72MB/s for
    // 640x480) which fills its TCP send buffer in seconds and then stalls.
    vnc_request_in_flight: bool = false,
    vnc_frames_received: u32 = 0,
    vnc_last_log_frames: u32 = 0,

    // Y-flip scratch buffer for uploadPixels. Size matches pixel_buf;
    // re-allocated on framebuffer resize (DesktopSize). Kept separate so
    // pixel_buf stays canonical top-down across incremental updates.
    flip_buf: ?[]u8 = null,

    fn deinit(self: *Feed) void {
        // Use release() (refcount drop) rather than destroy() — destroy()
        // marks the texture immediately destroyed so any queued draw call
        // referencing it via a bind_group fails wgpu validation. release()
        // lets the refcount keep it alive until the queue submit consuming
        // those bind_groups completes.
        if (self.bind_group) |bg| bg.release();
        if (self.sampler) |s| s.release();
        if (self.texture_view) |tv| tv.release();
        if (self.texture) |t| t.release();
        self.bind_group = null;
        self.sampler = null;
        self.texture_view = null;
        self.texture = null;

        if (self.pixel_buf) |buf| page_alloc.free(buf);
        self.pixel_buf = null;
        if (self.flip_buf) |buf| page_alloc.free(buf);
        self.flip_buf = null;

        self.releaseXShm();

        if (self.display_dpy) |dpy| _ = x11.XCloseDisplay(dpy);
        self.display_dpy = null;

        self.closeVnc();
        self.closeFFmpeg();
        self.killSubprocesses();

        // The source string was duped into feed-owned memory by createFeed
        // so the feed lifetime is independent of the cart-side allocation.
        // Free it and clear the parsed slices (which point INTO source) to
        // avoid dangling references when the slot is reused.
        if (self.source.len > 0) page_alloc.free(self.source);
        self.source = "";
        self.parsed = .{};

        self.status = .stopped;
    }

    fn releaseXShm(self: *Feed) void {
        if (self.xshm_image) |img| {
            const dpy = self.display_dpy orelse x_display orelse return;
            if (self.xshm_info.shmid >= 0) {
                _ = xext.XShmDetach(dpy, &self.xshm_info);
                if (self.xshm_info.shmaddr) |addr| _ = shmdt(addr);
                self.xshm_info.shmid = -1;
                self.xshm_info.shmaddr = null;
            }
            img.data = null;
            _ = x11.XFree(@ptrCast(img));
            self.xshm_image = null;
        }
    }

    fn closeVnc(self: *Feed) void {
        if (self.vnc_socket) |sock| posix.close(sock);
        self.vnc_socket = null;
        self.vnc_state = .not_connected;
    }

    fn closeFFmpeg(self: *Feed) void {
        if (self.ffmpeg_child) |*child| {
            child.kill(host_io.io());
        }
        self.ffmpeg_child = null;
        self.ffmpeg_stdout = null;
        self.ffmpeg_read_offset = 0;
    }

    fn killSubprocesses(self: *Feed) void {
        if (self.qemu_child) |*child| {
            child.kill(host_io.io());
        }
        self.qemu_child = null;
        if (self.app_child) |*child| {
            child.kill(host_io.io());
        }
        self.app_child = null;
        if (self.x_server_child) |*child| {
            child.kill(host_io.io());
        }
        self.x_server_child = null;
    }
};

pub var feeds: [MAX_FEEDS]Feed = [_]Feed{.{}} ** MAX_FEEDS;
pub var feed_count: usize = 0;

// ════════════════════════════════════════════════════════════════════════
// VNC RFB protocol state machine
// ════════════════════════════════════════════════════════════════════════

pub const VncState = enum {
    not_connected,
    wait_version, // waiting for server RFB version (12 bytes)
    wait_security_types, // waiting for security type count
    wait_security_result, // waiting for security result (4 bytes)
    wait_server_init, // waiting for ServerInit (24 bytes + name)
    ready, // can send FramebufferUpdateRequest, read updates
    failed,
};

// ════════════════════════════════════════════════════════════════════════
// X11/XShm initialization (runtime dlopen)
// ════════════════════════════════════════════════════════════════════════

extern fn dlopen(filename: ?[*:0]const u8, flags: c_int) ?*anyopaque;
extern fn dlsym(handle: *anyopaque, symbol: [*:0]const u8) ?*anyopaque;
extern fn dlclose(handle: *anyopaque) c_int;
const RTLD_LAZY: c_int = 0x00001;

// Non-fatal X protocol error handler. Xlib's default prints the error and
// calls exit() — fatal for a wall of capture feeds, where one feed's
// XShmGetImage BadMatch (e.g. transient geometry mismatch) would otherwise
// kill every other terminal. Returning here makes the offending call fail
// (returns 0) instead, so captureXShm just bails for that frame and retries.
fn xErrorHandler(dpy: ?*Display, ev: ?*XErrorEvent) callconv(.c) c_int {
    _ = dpy;
    if (ev) |e| {
        log.print("[render] non-fatal X error: code={d} request={d} minor={d}\n", .{ e.error_code, e.request_code, e.minor_code });
    }
    return 0;
}

// I/O error handler — fires when a feed's Xvfb connection breaks. The legacy
// contract still exits on most libX11 builds, so this is best-effort logging;
// the real defense against a dead Xvfb is the liveness check in update()
// (we stop capturing from a feed whose Xvfb child has exited).
fn xIOErrorHandler(dpy: ?*Display) callconv(.c) c_int {
    _ = dpy;
    log.print("[render] X I/O error (display connection broken) — feed will be retired\n", .{});
    return 0;
}

fn loadSym(comptime T: type, handle: *anyopaque, name: [*:0]const u8) ?T {
    const ptr = dlsym(handle, name) orelse return null;
    return @ptrCast(@alignCast(ptr));
}

fn initXShm() bool {
    if (x11_load_attempted) return xshm_available;
    x11_load_attempted = true;

    x11_lib = dlopen("libX11.so.6", RTLD_LAZY) orelse dlopen("libX11.so", RTLD_LAZY) orelse {
        log.info(.render, "libX11 not found", .{});
        return false;
    };
    xext_lib = dlopen("libXext.so.6", RTLD_LAZY) orelse dlopen("libXext.so", RTLD_LAZY) orelse {
        log.info(.render, "libXext not found", .{});
        return false;
    };

    x11.XOpenDisplay = loadSym(@TypeOf(x11.XOpenDisplay), x11_lib.?, "XOpenDisplay") orelse return false;
    x11.XCloseDisplay = loadSym(@TypeOf(x11.XCloseDisplay), x11_lib.?, "XCloseDisplay") orelse return false;
    x11.XDefaultRootWindow = loadSym(@TypeOf(x11.XDefaultRootWindow), x11_lib.?, "XDefaultRootWindow") orelse return false;
    x11.XDefaultScreen = loadSym(@TypeOf(x11.XDefaultScreen), x11_lib.?, "XDefaultScreen") orelse return false;
    x11.XDefaultVisual = loadSym(@TypeOf(x11.XDefaultVisual), x11_lib.?, "XDefaultVisual") orelse return false;
    x11.XDefaultDepth = loadSym(@TypeOf(x11.XDefaultDepth), x11_lib.?, "XDefaultDepth") orelse return false;
    x11.XDisplayWidth = loadSym(@TypeOf(x11.XDisplayWidth), x11_lib.?, "XDisplayWidth") orelse return false;
    x11.XDisplayHeight = loadSym(@TypeOf(x11.XDisplayHeight), x11_lib.?, "XDisplayHeight") orelse return false;
    x11.XFree = loadSym(@TypeOf(x11.XFree), x11_lib.?, "XFree") orelse return false;

    xext.XShmQueryExtension = loadSym(@TypeOf(xext.XShmQueryExtension), xext_lib.?, "XShmQueryExtension") orelse return false;
    xext.XShmCreateImage = loadSym(@TypeOf(xext.XShmCreateImage), xext_lib.?, "XShmCreateImage") orelse return false;
    xext.XShmAttach = loadSym(@TypeOf(xext.XShmAttach), xext_lib.?, "XShmAttach") orelse return false;
    xext.XShmDetach = loadSym(@TypeOf(xext.XShmDetach), xext_lib.?, "XShmDetach") orelse return false;
    xext.XShmGetImage = loadSym(@TypeOf(xext.XShmGetImage), xext_lib.?, "XShmGetImage") orelse return false;

    // Additional X11 functions for input forwarding
    x11.XFlush = loadSym(@TypeOf(x11.XFlush), x11_lib.?, "XFlush") orelse return false;
    x11.XWarpPointer = loadSym(@TypeOf(x11.XWarpPointer), x11_lib.?, "XWarpPointer") orelse return false;
    x11.XKeysymToKeycode = loadSym(@TypeOf(x11.XKeysymToKeycode), x11_lib.?, "XKeysymToKeycode") orelse return false;

    // Install non-fatal error handlers BEFORE opening any display, so no X
    // protocol error can ever reach Xlib's default exit() handler. Global to
    // the process (not per-display), so set once. Optional — if a build lacks
    // the symbol we just keep Xlib's default rather than fail capture init.
    if (loadSym(@TypeOf(x11.XSetErrorHandler), x11_lib.?, "XSetErrorHandler")) |f| {
        x11.XSetErrorHandler = f;
        _ = x11.XSetErrorHandler(&xErrorHandler);
    }
    if (loadSym(@TypeOf(x11.XSetIOErrorHandler), x11_lib.?, "XSetIOErrorHandler")) |f| {
        x11.XSetIOErrorHandler = f;
        _ = x11.XSetIOErrorHandler(&xIOErrorHandler);
    }

    // XTest extension (for synthetic input — zero subprocess overhead)
    xtst_lib = dlopen("libXtst.so.6", RTLD_LAZY) orelse dlopen("libXtst.so", RTLD_LAZY);
    if (xtst_lib) |lib| {
        const key_fn = loadSym(@TypeOf(xtst.XTestFakeKeyEvent), lib, "XTestFakeKeyEvent");
        const btn_fn = loadSym(@TypeOf(xtst.XTestFakeButtonEvent), lib, "XTestFakeButtonEvent");
        const mot_fn = loadSym(@TypeOf(xtst.XTestFakeMotionEvent), lib, "XTestFakeMotionEvent");
        if (key_fn != null and btn_fn != null and mot_fn != null) {
            xtst.XTestFakeKeyEvent = key_fn.?;
            xtst.XTestFakeButtonEvent = btn_fn.?;
            xtst.XTestFakeMotionEvent = mot_fn.?;
            xtest_available = true;
            log.info(.render, "XTest extension loaded (fast input path)", .{});
        }
    }

    const display_env = host_io.getenv("DISPLAY") orelse {
        log.info(.render, "no DISPLAY env", .{});
        return false;
    };
    var display_name_buf: [64]u8 = undefined;
    if (display_env.len >= display_name_buf.len) return false;
    @memcpy(display_name_buf[0..display_env.len], display_env);
    display_name_buf[display_env.len] = 0;
    const display_name: [*:0]const u8 = display_name_buf[0..display_env.len :0];

    x_display = x11.XOpenDisplay(display_name) orelse {
        log.info(.render, "XOpenDisplay failed", .{});
        return false;
    };

    if (xext.XShmQueryExtension(x_display.?) == 0) {
        _ = x11.XCloseDisplay(x_display.?);
        x_display = null;
        log.info(.render, "XShm extension not available", .{});
        return false;
    }

    x_screen = x11.XDefaultScreen(x_display.?);
    x_root = x11.XDefaultRootWindow(x_display.?);
    xshm_available = true;
    log.info(.render, "XShm capture ready", .{});
    return true;
}

/// Open a dedicated X connection to a specific display (e.g. ":10" for virtual display)
fn openDisplayConnection(display_num: u32) ?*Display {
    var buf: [16]u8 = undefined;
    const name = std.fmt.bufPrint(&buf, ":{d}", .{display_num}) catch return null;
    buf[name.len] = 0;
    const cname: [*:0]const u8 = buf[0..name.len :0];
    return x11.XOpenDisplay(cname);
}

// ════════════════════════════════════════════════════════════════════════
// XShm capture context creation
// ════════════════════════════════════════════════════════════════════════

fn createXShmCapture(feed: *Feed, dpy: *Display, w: u32, h: u32) bool {
    const scr = if (feed.display_dpy != null) x11.XDefaultScreen(dpy) else x_screen;
    const visual = x11.XDefaultVisual(dpy, scr) orelse return false;
    const depth: c_uint = @intCast(x11.XDefaultDepth(dpy, scr));

    feed.xshm_info = .{ .shmseg = 0, .shmid = -1, .shmaddr = null, .read_only = 0 };

    const ximage = xext.XShmCreateImage(dpy, visual, depth, ZPixmap, null, &feed.xshm_info, @intCast(w), @intCast(h)) orelse return false;

    const shmsize: usize = @intCast(@as(c_uint, @intCast(ximage.bytes_per_line)) * @as(c_uint, @intCast(ximage.height)));
    feed.xshm_info.shmid = shmget(IPC_PRIVATE, shmsize, IPC_CREAT | 0o666);
    if (feed.xshm_info.shmid < 0) {
        _ = x11.XFree(@ptrCast(ximage));
        return false;
    }

    const shm_ptr = shmat(feed.xshm_info.shmid, null, 0) orelse {
        _ = shmctl(feed.xshm_info.shmid, IPC_RMID, null);
        _ = x11.XFree(@ptrCast(ximage));
        return false;
    };
    feed.xshm_info.shmaddr = @ptrCast(@alignCast(shm_ptr));
    ximage.data = @ptrCast(@alignCast(shm_ptr));
    feed.xshm_info.read_only = 0;

    _ = xext.XShmAttach(dpy, &feed.xshm_info);
    _ = shmctl(feed.xshm_info.shmid, IPC_RMID, null);

    feed.xshm_image = ximage;
    feed.width = w;
    feed.height = h;
    return true;
}

/// Capture a frame via XShm: BGRX → RGBA conversion into feed.pixel_buf
fn captureXShm(feed: *Feed) bool {
    const dpy = feed.display_dpy orelse x_display orelse return false;
    const img = feed.xshm_image orelse return false;
    const dest = feed.pixel_buf orelse return false;
    const drawable = if (feed.display_dpy != null) feed.display_root else x_root;

    if (xext.XShmGetImage(dpy, drawable, img, feed.capture_ox, feed.capture_oy, AllPlanes) == 0) return false;

    const src: [*]const u8 = img.data orelse return false;
    const w = feed.width;
    const h = feed.height;
    const bpl: usize = @intCast(img.bytes_per_line);
    const w4 = w * 4;

    if (bpl == w4) {
        const npixels = w * h;
        var i: usize = 0;
        while (i < npixels * 4) : (i += 4) {
            dest[i] = src[i + 2]; // R
            dest[i + 1] = src[i + 1]; // G
            dest[i + 2] = src[i]; // B
            dest[i + 3] = 255; // A
        }
    } else {
        var y: usize = 0;
        while (y < h) : (y += 1) {
            const src_row = y * bpl;
            const dst_row = y * w4;
            var px: usize = 0;
            while (px < w4) : (px += 4) {
                dest[dst_row + px] = src[src_row + px + 2];
                dest[dst_row + px + 1] = src[src_row + px + 1];
                dest[dst_row + px + 2] = src[src_row + px];
                dest[dst_row + px + 3] = 255;
            }
        }
    }

    feed.dirty = true;
    return true;
}

// ════════════════════════════════════════════════════════════════════════
// wgpu texture creation (same pattern as videos.zig)
// ════════════════════════════════════════════════════════════════════════

fn ensureTexture(feed: *Feed) bool {
    if (feed.bind_group != null) return true;
    const device = gpu_core.getDevice() orelse return false;
    const w = feed.width;
    const h = feed.height;
    if (w == 0 or h == 0) return false;

    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("render_surface"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
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

    feed.texture = tex;
    feed.texture_view = view;
    feed.sampler = sampler;
    feed.bind_group = bg;
    return true;
}

fn uploadPixels(feed: *Feed) void {
    if (!feed.dirty) return;
    feed.dirty = false;

    const tex = feed.texture orelse return;
    const buf = feed.pixel_buf orelse return;
    const queue = gpu_core.getQueue() orelse return;
    const w = feed.width;
    const h = feed.height;
    const row_bytes: usize = @as(usize, w) * 4;
    const total_bytes: usize = row_bytes * @as(usize, h);

    // Force alpha=0xff for every pixel. None of our capture sources produce
    // semantically meaningful alpha — VNC at depth=24 leaves byte 3 as 0,
    // XShm BGRX leaves it as 0, FFmpeg rawvideo varies. wgpu's rgba8_unorm
    // sampler reads byte 3 as alpha, so without this the textured quad
    // renders fully transparent and the surface behind it bleeds through.
    var i: usize = 3;
    while (i < buf.len) : (i += 4) buf[i] = 0xff;

    // Y-flip into a scratch buffer, then upload that. The previous in-place
    // flip mutated pixel_buf, so VNC incremental updates (which write new
    // partial rects in top-down coordinates into the SAME pixel_buf between
    // uploads) landed at the wrong vertical position — every other frame
    // appeared upside-down, with cursor sprites and partial rects visibly
    // wrong. Using a separate scratch buffer keeps pixel_buf canonical
    // (top-down) regardless of how many times uploadPixels runs.
    //
    // The shared image shader does `1.0 - corner.y` for GL-readback sources
    // (mpv); we cancel that here by uploading row-reversed bytes.
    if (feed.flip_buf == null or (feed.flip_buf.?.len != total_bytes)) {
        if (feed.flip_buf) |old| page_alloc.free(old);
        feed.flip_buf = page_alloc.alloc(u8, total_bytes) catch return;
    }
    const flip = feed.flip_buf.?;
    var row: usize = 0;
    while (row < h) : (row += 1) {
        const src_off = row * row_bytes;
        const dst_off = (h - 1 - row) * row_bytes;
        @memcpy(flip[dst_off .. dst_off + row_bytes], buf[src_off .. src_off + row_bytes]);
    }

    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        @ptrCast(flip.ptr),
        total_bytes,
        &.{ .offset = 0, .bytes_per_row = w * 4, .rows_per_image = h },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
}

// ════════════════════════════════════════════════════════════════════════
// FFmpeg subprocess backend (cam/hdmi/v4l2/window fallback/screen fallback)
// ════════════════════════════════════════════════════════════════════════

/// Spawn ffmpeg as a child process writing raw RGBA to stdout.
fn startFFmpeg(feed: *Feed, parsed: ParsedSource, fps: u32, w: u32, h: u32) bool {
    var dev_buf: [32]u8 = undefined;
    var size_buf: [16]u8 = undefined;
    var fps_buf: [8]u8 = undefined;

    const size_str = std.fmt.bufPrint(&size_buf, "{d}x{d}", .{ w, h }) catch return false;
    const fps_str = std.fmt.bufPrint(&fps_buf, "{d}", .{fps}) catch return false;

    // Build argv as []const u8 slices (Zig 0.15 Child.init API)
    var argv: [20][]const u8 = undefined;
    var argc: usize = 0;

    argv[argc] = "ffmpeg";
    argc += 1;
    argv[argc] = "-nostdin";
    argc += 1;
    argv[argc] = "-loglevel";
    argc += 1;
    argv[argc] = "quiet";
    argc += 1;

    switch (parsed.source_type) {
        .cam, .hdmi, .v4l2 => {
            const device_str: []const u8 = switch (parsed.source_type) {
                .cam, .hdmi => std.fmt.bufPrint(&dev_buf, "/dev/video{d}", .{parsed.index}) catch return false,
                .v4l2 => parsed.device orelse return false,
                else => unreachable,
            };

            argv[argc] = "-f";
            argc += 1;
            argv[argc] = "v4l2";
            argc += 1;
            argv[argc] = "-framerate";
            argc += 1;
            argv[argc] = fps_str;
            argc += 1;
            argv[argc] = "-video_size";
            argc += 1;
            argv[argc] = size_str;
            argc += 1;
            argv[argc] = "-i";
            argc += 1;
            argv[argc] = device_str;
            argc += 1;
        },
        .screen => {
            const display_env = host_io.getenv("DISPLAY") orelse ":0";
            argv[argc] = "-f";
            argc += 1;
            argv[argc] = "x11grab";
            argc += 1;
            argv[argc] = "-framerate";
            argc += 1;
            argv[argc] = fps_str;
            argc += 1;
            argv[argc] = "-video_size";
            argc += 1;
            argv[argc] = size_str;
            argc += 1;
            argv[argc] = "-i";
            argc += 1;
            argv[argc] = display_env;
            argc += 1;
        },
        else => return false,
    }

    // Output format: raw RGBA to stdout
    argv[argc] = "-f";
    argc += 1;
    argv[argc] = "rawvideo";
    argc += 1;
    argv[argc] = "-pix_fmt";
    argc += 1;
    argv[argc] = "rgba";
    argc += 1;
    argv[argc] = "-an";
    argc += 1;
    argv[argc] = "-sn";
    argc += 1;
    argv[argc] = "-";
    argc += 1;

    const child = std.process.spawn(host_io.io(), .{
        .argv = argv[0..argc],
        .stdout = .pipe,
        .stderr = .ignore,
        .stdin = .ignore,
    }) catch |err| {
        log.info(.render, "FFmpeg spawn failed: {}", .{err});
        return false;
    };

    feed.ffmpeg_child = child;
    feed.ffmpeg_stdout = child.stdout.?;

    // Set stdout to non-blocking so update() doesn't stall
    const fd = child.stdout.?.handle;
    setNonBlocking(fd);

    feed.width = w;
    feed.height = h;
    feed.pixel_buf = page_alloc.alloc(u8, @as(usize, w) * @as(usize, h) * 4) catch return false;
    feed.ffmpeg_read_offset = 0;
    feed.backend = .ffmpeg;
    feed.status = .ready;

    log.info(.render, "FFmpeg capture started ({d}x{d})", .{ w, h });
    return true;
}

/// Read available data from FFmpeg stdout pipe. Non-blocking.
/// When a full frame (w*h*4 bytes) is accumulated, marks dirty.
fn updateFFmpeg(feed: *Feed) void {
    const stdout_file = feed.ffmpeg_stdout orelse return;
    const buf = feed.pixel_buf orelse return;
    const frame_size = @as(usize, feed.width) * @as(usize, feed.height) * 4;
    if (frame_size == 0) return;

    // Read as much as available (non-blocking)
    const remaining = frame_size - feed.ffmpeg_read_offset;
    const dest = buf[feed.ffmpeg_read_offset..frame_size];

    const n = posix.read(stdout_file.handle, dest[0..remaining]) catch |err| {
        if (err == error.WouldBlock) return; // no data yet, try next frame
        feed.status = .@"error";
        return;
    };

    if (n == 0) {
        // pipe closed — ffmpeg died
        feed.status = .@"error";
        return;
    }

    feed.ffmpeg_read_offset += n;
    if (feed.ffmpeg_read_offset >= frame_size) {
        feed.ffmpeg_read_offset = 0;
        feed.dirty = true;
    }
}

// ════════════════════════════════════════════════════════════════════════
// Window capture via xdotool + XShm at root offset
// ════════════════════════════════════════════════════════════════════════

/// Run xdotool to find a window by title and get its geometry.
/// Returns (x, y, w, h) or null if not found.
fn findWindowGeometry(title: []const u8) ?struct { x: c_int, y: c_int, w: u32, h: u32 } {
    var script_buf: [512]u8 = undefined;
    const script = std.fmt.bufPrint(
        &script_buf,
        "WID=$(xdotool search --name \"{s}\" 2>/dev/null | head -1); if [ -n \"$WID\" ]; then eval $(xdotool getwindowgeometry --shell $WID 2>/dev/null); echo \"$X $Y $WIDTH $HEIGHT\"; fi",
        .{title},
    ) catch return null;

    const argv = [_][]const u8{ "bash", "-c", script };
    var child = std.process.spawn(host_io.io(), .{
        .argv = &argv,
        .stdout = .pipe,
        .stderr = .ignore,
        .stdin = .ignore,
    }) catch return null;

    var out_buf: [128]u8 = undefined;
    const stdout = child.stdout orelse {
        _ = child.wait(host_io.io()) catch {};
        return null;
    };
    const n = posix.read(stdout.handle, &out_buf) catch 0;
    _ = child.wait(host_io.io()) catch {};

    if (n == 0) return null;

    // Parse "X Y WIDTH HEIGHT\n"
    var iter = std.mem.splitScalar(u8, std.mem.trimEnd(u8, out_buf[0..n], "\n"), ' ');
    const x_str = iter.next() orelse return null;
    const y_str = iter.next() orelse return null;
    const w_str = iter.next() orelse return null;
    const h_str = iter.next() orelse return null;

    const wx = std.fmt.parseInt(c_int, x_str, 10) catch return null;
    const wy = std.fmt.parseInt(c_int, y_str, 10) catch return null;
    const ww = std.fmt.parseInt(u32, w_str, 10) catch return null;
    const wh = std.fmt.parseInt(u32, h_str, 10) catch return null;

    if (ww == 0 or wh == 0) return null;
    return .{ .x = wx, .y = wy, .w = ww, .h = wh };
}

// ════════════════════════════════════════════════════════════════════════
// Virtual display management (Xvfb / Xephyr)
// ════════════════════════════════════════════════════════════════════════

fn findFreeDisplay() ?u32 {
    var i: u32 = 10;
    while (i < 100) : (i += 1) {
        var lock_buf: [32]u8 = undefined;
        const lock_path = std.fmt.bufPrint(&lock_buf, "/tmp/.X{d}-lock", .{i}) catch continue;
        // Try to stat the lock file — if it doesn't exist, the display is free
        const stat = std.Io.Dir.cwd().statFile(host_io.io(), lock_path, .{}) catch {
            return i; // file doesn't exist = display free
        };
        _ = stat;
    }
    return null;
}

// Cached check: is `setpriv` (util-linux) available? We launch Xvfb under
// `setpriv --pdeathsig KILL` so the kernel SIGKILLs each Xvfb the moment our
// process dies — by ANY cause: clean exit, panic, segfault, even SIGKILL,
// where no userspace cleanup handler could ever run. Killing the Xvfb cascades:
// its kitty loses the X connection and exits, which SIGHUPs the app (claude)
// under it. This is the keystone that makes <Render> leak-proof on crash.
// setpriv execs in place (same PID), so feed.x_server_child bookkeeping —
// kill/wait/SIGSTOP — keeps targeting Xvfb unchanged.
var setpriv_checked: bool = false;
var setpriv_ok: bool = false;
fn hasSetpriv() bool {
    if (setpriv_checked) return setpriv_ok;
    setpriv_checked = true;
    setpriv_ok = blk: {
        std.Io.Dir.accessAbsolute(host_io.io(), "/usr/bin/setpriv", .{}) catch {
            std.Io.Dir.accessAbsolute(host_io.io(), "/bin/setpriv", .{}) catch break :blk false;
            break :blk true;
        };
        break :blk true;
    };
    if (!setpriv_ok) log.info(.render, "setpriv not found — Xvfb won't auto-die on crash; orphans possible", .{});
    return setpriv_ok;
}

fn spawnXvfb(display_num: u32, w: u32, h: u32) ?std.process.Child {
    var disp_buf: [8]u8 = undefined;
    const disp_str = std.fmt.bufPrint(&disp_buf, ":{d}", .{display_num}) catch return null;

    var screen_buf: [32]u8 = undefined;
    const screen_str = std.fmt.bufPrint(&screen_buf, "{d}x{d}x24", .{ w, h }) catch return null;

    // Prefer launching Xvfb under setpriv --pdeathsig KILL (parent-death =
    // auto-SIGKILL). Fall back to a bare spawn if setpriv is unavailable.
    const argv_guarded = [_][]const u8{ "setpriv", "--pdeathsig", "KILL", "--", "Xvfb", disp_str, "-screen", "0", screen_str };
    const argv_bare = [_][]const u8{ "Xvfb", disp_str, "-screen", "0", screen_str };

    return std.process.spawn(host_io.io(), .{
        .argv = if (hasSetpriv()) &argv_guarded else &argv_bare,
        .stdout = .ignore,
        .stderr = .ignore,
        .stdin = .ignore,
    }) catch return null;
}

fn startVirtualDisplay(feed: *Feed, w: u32, h: u32, command: ?[]const u8) bool {
    if (!initXShm()) return false;

    const display_num = findFreeDisplay() orelse {
        log.info(.render, "no free X display number", .{});
        return false;
    };

    var child = spawnXvfb(display_num, w, h) orelse {
        log.info(.render, "Xvfb spawn failed", .{});
        return false;
    };
    _ = &child;

    feed.x_server_child = child;
    feed.display_num = display_num;
    feed.app_command = command;
    feed.width = w;
    feed.height = h;
    feed.pixel_buf = page_alloc.alloc(u8, @as(usize, w) * @as(usize, h) * 4) catch return false;
    feed.backend = .display_xshm;
    feed.status = .starting;
    feed.startup_wait = 60; // wait ~1s at 60fps for Xvfb to start
    feed.interactive = true;

    log.info(.render, "Virtual display :{d} ({d}x{d}) starting", .{ display_num, w, h });
    return true;
}

/// Called during update() to finish virtual display initialization after Xvfb has started.
fn finalizeVirtualDisplay(feed: *Feed) void {
    if (feed.startup_wait > 0) {
        feed.startup_wait -= 1;
        return;
    }

    const display_num = feed.display_num orelse return;

    // Open dedicated X connection to virtual display
    const dpy = openDisplayConnection(display_num) orelse {
        // Xvfb may need more time
        feed.startup_wait = 30;
        return;
    };

    if (xext.XShmQueryExtension(dpy) == 0) {
        _ = x11.XCloseDisplay(dpy);
        feed.status = .@"error";
        log.info(.render, "XShm not available on :{d}", .{display_num});
        return;
    }

    feed.display_dpy = dpy;
    const scr = x11.XDefaultScreen(dpy);
    feed.display_root = x11.XDefaultRootWindow(dpy);

    // Create XShm capture for the virtual display
    const visual = x11.XDefaultVisual(dpy, scr) orelse {
        feed.status = .@"error";
        return;
    };
    const depth: c_uint = @intCast(x11.XDefaultDepth(dpy, scr));

    feed.xshm_info = .{ .shmseg = 0, .shmid = -1, .shmaddr = null, .read_only = 0 };
    const ximage = xext.XShmCreateImage(dpy, visual, depth, ZPixmap, null, &feed.xshm_info, @intCast(feed.width), @intCast(feed.height)) orelse {
        feed.status = .@"error";
        return;
    };

    const shmsize: usize = @intCast(@as(c_uint, @intCast(ximage.bytes_per_line)) * @as(c_uint, @intCast(ximage.height)));
    feed.xshm_info.shmid = shmget(IPC_PRIVATE, shmsize, IPC_CREAT | 0o666);
    if (feed.xshm_info.shmid < 0) {
        _ = x11.XFree(@ptrCast(ximage));
        feed.status = .@"error";
        return;
    }
    const shm_ptr = shmat(feed.xshm_info.shmid, null, 0) orelse {
        _ = shmctl(feed.xshm_info.shmid, IPC_RMID, null);
        _ = x11.XFree(@ptrCast(ximage));
        feed.status = .@"error";
        return;
    };
    feed.xshm_info.shmaddr = @ptrCast(@alignCast(shm_ptr));
    ximage.data = @ptrCast(@alignCast(shm_ptr));
    feed.xshm_info.read_only = 0;

    _ = xext.XShmAttach(dpy, &feed.xshm_info);
    _ = shmctl(feed.xshm_info.shmid, IPC_RMID, null);

    feed.xshm_image = ximage;
    feed.status = .ready;
    log.info(.render, "Virtual display :{d} ready ({d}x{d})", .{ display_num, feed.width, feed.height });

    // Launch the app command into the virtual display.
    // After launching, maximize the window so it fills the display (matching Lua AppEmbed).
    // The Lua version relies on apps specifying their own geometry (e.g. kitty -o initial_window_width=W),
    // but as a fallback we find and resize the first window to fill the display.
    if (feed.app_command) |cmd| {
        log.info(.render, "Launching app into :{d}: {s}", .{ display_num, cmd });

        // Launch: DISPLAY=:N <command> & sleep 0.5; DISPLAY=:N xdotool search --onlyvisible --name "" windowsize W H windowmove 0 0
        // This launches the app, waits for it to create a window, then resizes it to fill.
        var launch_buf: [2048]u8 = undefined;
        const launch_cmd = std.fmt.bufPrint(&launch_buf, "DISPLAY=:{d} {s} & sleep 0.8; DISPLAY=:{d} xdotool search --onlyvisible --name '' windowsize --usehints {d} {d} windowmove 0 0 2>/dev/null", .{ display_num, cmd, display_num, feed.width, feed.height }) catch return;

        const launch_argv = [_][]const u8{ "bash", "-c", launch_cmd };
        const app = std.process.spawn(host_io.io(), .{
            .argv = &launch_argv,
            .stdout = .ignore,
            .stderr = .ignore,
            .stdin = .ignore,
        }) catch |err| {
            log.info(.render, "App spawn failed: {}", .{err});
            return;
        };
        feed.app_child = app;
        log.info(.render, "App launched into :{d} ({d}x{d})", .{ display_num, feed.width, feed.height });
    }
}

// ════════════════════════════════════════════════════════════════════════
// VNC RFB client (for VM capture and direct VNC)
// ════════════════════════════════════════════════════════════════════════

fn findFeed(src: []const u8) ?*Feed {
    for (feeds[0..feed_count]) |*f| {
        // Skip stopped slots — their source has been freed and is "" sentinel.
        if (f.status == .stopped) continue;
        if (std.mem.eql(u8, f.source, src)) return f;
    }
    return null;
}

fn allocBuf(w: u32, h: u32) ?[]u8 {
    return page_alloc.alloc(u8, @as(usize, w) * @as(usize, h) * 4) catch return null;
}

fn setError(feed: *Feed) void {
    feed.status = .@"error";
}

/// Pick a feed slot — prefer reusing a stopped slot, otherwise grow feeds[].
/// Returns null if all slots are live and we're at MAX_FEEDS.
fn acquireFeedSlot() ?*Feed {
    for (feeds[0..feed_count]) |*f| {
        if (f.status == .stopped) return f;
    }
    if (feed_count >= MAX_FEEDS) return null;
    const f = &feeds[feed_count];
    feed_count += 1;
    return f;
}

// ── OOM guard ────────────────────────────────────────────────────────────
// Each display/app:/vm: feed spawns a detached Xvfb + app (kitty, often
// claude — hundreds of MB). An unbounded wall exhausts RAM and thrashes swap
// into a desktop lockup. We refuse to spawn a new heavy feed once free memory
// would drop below a reserve floor, so <Render> can never OOM the machine.
//   RENDER_MEM_RESERVE_MB  — hard floor of free RAM to keep (default 2048)
//   RENDER_MEM_PER_FEED_MB — est. cost reserved per in-flight feed (default 600)
fn availableMemMb() u64 {
    const f = std.Io.Dir.openFileAbsolute(host_io.io(), "/proc/meminfo", .{}) catch return 0;
    defer f.close(host_io.io());
    var buf: [4096]u8 = undefined;
    const n = f.readPositionalAll(host_io.io(), &buf, 0) catch return 0;
    const txt = buf[0..n];
    const key = "MemAvailable:";
    const idx = std.mem.indexOf(u8, txt, key) orelse return 0;
    var i: usize = idx + key.len;
    while (i < txt.len and (txt[i] == ' ' or txt[i] == '\t')) i += 1;
    var kb: u64 = 0;
    while (i < txt.len and txt[i] >= '0' and txt[i] <= '9') : (i += 1) kb = kb * 10 + (txt[i] - '0');
    return kb / 1024; // MiB
}

fn envU64(name: [:0]const u8, default: u64) u64 {
    const v = host_io.getenv(name) orelse return default;
    return std.fmt.parseInt(u64, v, 10) catch default;
}

// Feeds spawned but not yet at steady-state RSS (claude keeps growing for a few
// seconds after launch). Reserve budget for them so a rapid burst of adds can't
// overshoot before their memory shows up in MemAvailable.
fn unsettledFeedCount() u64 {
    var n: u64 = 0;
    for (feeds[0..feed_count]) |*f| {
        if (f.status == .stopped) continue;
        if (f.backend == .display_xshm or f.backend == .vnc) {
            if (f.status == .starting) n += 1;
        }
    }
    return n;
}

/// Returns true if there's enough free RAM to safely spawn one more heavy feed.
/// Exported so the cart can soft-guard the UI with the same policy the host enforces.
pub fn memoryHeadroomOk() bool {
    const avail = availableMemMb();
    if (avail == 0) return true; // can't read meminfo → don't block
    const reserve = envU64("RENDER_MEM_RESERVE_MB", 2048);
    const per_feed = envU64("RENDER_MEM_PER_FEED_MB", 600);
    const required = reserve + (unsettledFeedCount() + 1) * per_feed;
    return avail >= required;
}

fn createFeed(src: []const u8, node_w: f32, node_h: f32) ?*Feed {
    // In headless/snapshot mode (set by scripts/ship for autotest runs)
    // skip subprocess spawning entirely. Spawning qemu/Xvfb/kitty here
    // leaks orphans that outlive the cart binary and inherit the ship
    // script's flock fd, blocking every subsequent build until reaped.
    if (host_io.getenv("ZIGOS_HEADLESS")) |v| {
        if (v.len > 0 and v[0] != '0') return null;
    }

    // OOM guard: only the process-spawning source types are heavy.
    const probe = parseSource(src);
    if (probe.source_type == .display or probe.source_type == .vm) {
        if (!memoryHeadroomOk()) {
            log.info(.render, "OOM guard: refusing new feed — {d}MB free below reserve+per-feed budget", .{availableMemMb()});
            return null;
        }
    }

    const feed = acquireFeedSlot() orelse return null;

    // Own the source string. The caller passed a slice into cart-allocated
    // memory (node.render_src) whose lifetime ends when the React node
    // unmounts. The feed needs a stable pointer for findFeed's mem.eql and
    // for parsed.* slices (which index INTO source).
    const owned = page_alloc.dupe(u8, src) catch return null;
    const parsed = parseSource(owned);
    feed.* = .{ .source = owned, .parsed = parsed, .active = true };

    switch (parsed.source_type) {
        .screen => {
            // XShm screen capture (fast path). Falls back to FFmpeg if XShm unavailable.
            if (initXShm()) {
                const dpy = x_display orelse {
                    setError(feed);
                    feed_count += 1;
                    return feed;
                };
                const sw: u32 = @intCast(x11.XDisplayWidth(dpy, x_screen));
                const sh: u32 = @intCast(x11.XDisplayHeight(dpy, x_screen));

                if (createXShmCapture(feed, dpy, sw, sh)) {
                    feed.pixel_buf = allocBuf(sw, sh) orelse {
                        setError(feed);
                        feed_count += 1;
                        return feed;
                    };
                    feed.backend = .xshm;
                    feed.status = .ready;
                    log.info(.render, "XShm screen capture: {d}x{d}", .{ sw, sh });
                    feed_count += 1;
                    return feed;
                }
            }
            // Fallback: FFmpeg x11grab
            if (!startFFmpeg(feed, parsed, 30, 1920, 1080)) setError(feed);
        },

        .window => {
            // Window capture via XShm at root window offset
            if (!initXShm()) {
                setError(feed);
                return feed;
            }
            const title = parsed.title orelse {
                setError(feed);
                return feed;
            };

            const geom = findWindowGeometry(title) orelse {
                log.info(.render, "window not found: {s}", .{title});
                setError(feed);
                return feed;
            };

            // Clamp to screen bounds
            const dpy = x_display orelse {
                setError(feed);
                return feed;
            };
            const scr_w = x11.XDisplayWidth(dpy, x_screen);
            const scr_h = x11.XDisplayHeight(dpy, x_screen);
            var ww = geom.w;
            var wh = geom.h;
            var wx = geom.x;
            var wy = geom.y;
            if (wx + @as(c_int, @intCast(ww)) > scr_w) ww = @intCast(scr_w - wx);
            if (wy + @as(c_int, @intCast(wh)) > scr_h) wh = @intCast(scr_h - wy);
            if (wx < 0) {
                ww = @intCast(@as(c_int, @intCast(ww)) + wx);
                wx = 0;
            }
            if (wy < 0) {
                wh = @intCast(@as(c_int, @intCast(wh)) + wy);
                wy = 0;
            }

            if (ww == 0 or wh == 0) {
                setError(feed);
                return feed;
            }

            if (!createXShmCapture(feed, dpy, ww, wh)) {
                setError(feed);
                return feed;
            }
            feed.capture_ox = wx;
            feed.capture_oy = wy;
            feed.pixel_buf = allocBuf(ww, wh) orelse {
                setError(feed);
                return feed;
            };
            feed.backend = .xshm;
            feed.status = .ready;
            log.info(.render, "XShm window capture: {s} ({d}x{d}+{d}+{d})", .{ title, ww, wh, wx, wy });
        },

        .cam, .hdmi, .v4l2 => {
            // FFmpeg v4l2 capture
            if (!startFFmpeg(feed, parsed, 30, 1280, 720)) setError(feed);
        },

        .display => {
            // Virtual display (Xvfb) + XShm capture
            // Use node rect dimensions so the display matches the container exactly (no dead space).
            // If an explicit resolution was given, use that instead.
            var rw: u32 = @max(320, @as(u32, @intFromFloat(node_w)));
            var rh: u32 = @max(240, @as(u32, @intFromFloat(node_h)));
            if (parsed.resolution) |res| {
                if (std.mem.indexOfScalar(u8, res, 'x')) |xi| {
                    rw = std.fmt.parseInt(u32, res[0..xi], 10) catch rw;
                    rh = std.fmt.parseInt(u32, res[xi + 1 ..], 10) catch rh;
                }
            }
            log.info(.render, "display: creating {d}x{d} virtual display (node={d:.0}x{d:.0})", .{ rw, rh, node_w, node_h });
            if (!startVirtualDisplay(feed, rw, rh, parsed.command)) setError(feed);
        },

        .vm => {
            // QEMU + VNC capture
            const disk = parsed.path orelse {
                log.print("[render] VM: no disk path in source\n", .{});
                log.info(.render, "VM: no disk path in source", .{});
                setError(feed);
                return feed;
            };
            log.print("[render] VM: creating feed for disk={s}\n", .{disk});
            log.info(.render, "VM: creating feed for disk={s}", .{disk});
            if (!vm.startVM(feed, disk, 2048, 2)) {
                log.print("[render] VM: startVM FAILED\n", .{});
                log.info(.render, "VM: startVM FAILED", .{});
                setError(feed);
            }
        },

        .vnc_direct => {
            // Direct VNC connection (no QEMU)
            const host = parsed.host orelse "127.0.0.1";
            const port = parsed.port;
            if (port == 0) {
                setError(feed);
                return feed;
            }

            const sock = vm.connectVnc(host, port) orelse {
                log.info(.render, "VNC connect failed: {s}:{d}", .{ host, port });
                setError(feed);
                return feed;
            };

            feed.vnc_socket = sock;
            feed.vnc_state = .wait_version;
            feed.width = 1280;
            feed.height = 720;
            feed.pixel_buf = allocBuf(1280, 720) orelse {
                posix.close(sock);
                setError(feed);
                return feed;
            };
            feed.backend = .vnc;
            feed.status = .connecting;
            feed.interactive = true;
            log.info(.render, "VNC direct: {s}:{d}", .{ host, port });
        },

        .monitor => {
            // Virtual monitor via xrandr + XShm
            // Same as screen capture but at an xrandr-defined offset
            if (!initXShm()) {
                setError(feed);
                return feed;
            }
            // Use same dimensions as screen for now — xrandr integration
            // would need subprocess calls to set up the virtual monitor region
            const dpy = x_display orelse {
                setError(feed);
                return feed;
            };
            const sw: u32 = @intCast(x11.XDisplayWidth(dpy, x_screen));
            const sh: u32 = @intCast(x11.XDisplayHeight(dpy, x_screen));

            if (!createXShmCapture(feed, dpy, sw, sh)) {
                setError(feed);
                return feed;
            }
            feed.pixel_buf = allocBuf(sw, sh) orelse {
                setError(feed);
                return feed;
            };
            feed.backend = .xshm;
            feed.status = .ready;
            log.info(.render, "Monitor capture: {s} ({d}x{d})", .{ parsed.name orelse "?", sw, sh });
        },

        .unknown => setError(feed),
    }

    return feed;
}

// ════════════════════════════════════════════════════════════════════════
// Public API (called from engine.zig)
// ════════════════════════════════════════════════════════════════════════

pub fn init() void {
    // Backends init lazily on first createFeed().
}

pub fn deinit() void {
    for (feeds[0..feed_count]) |*f| f.deinit();
    feed_count = 0;

    if (x_display) |dpy| {
        _ = x11.XCloseDisplay(dpy);
        x_display = null;
    }
    if (xext_lib) |lib| _ = dlclose(lib);
    if (x11_lib) |lib| _ = dlclose(lib);
    xext_lib = null;
    x11_lib = null;
    xshm_available = false;
    x11_load_attempted = false;
}

/// Called every frame: poll backends for new frames.
var _upd_dbg: u32 = 0;

pub fn update() void {
    _upd_dbg +%= 1;
    if (_upd_dbg % 120 == 1 and feed_count > 0) log.info(.render, "update: {d} feeds", .{feed_count});

    for (feeds[0..feed_count]) |*feed| {
        // When suspended, skip ALL polling — qemu/Xvfb are SIGSTOPped, so
        // VNC server won't respond and XShm capture would just re-read
        // stale data. Last-rendered pixels stay on the texture; paint
        // continues to draw them. Mouse/key events are silently dropped
        // (the SIGSTOPped server can't process them anyway).
        if (feed.suspended) continue;
        switch (feed.status) {
            .ready => {
                // Liveness guard: if a virtual-display feed's Xvfb has exited,
                // its X connection is dead — capturing from it would trip an
                // Xlib I/O error (the legacy handler still exits on most
                // builds). Reap it (WNOHANG) and retire the feed instead of
                // ever issuing XShmGetImage against a broken connection.
                if (feed.backend == .display_xshm) {
                    if (feed.x_server_child) |child| {
                        const child_pid = child.id orelse 0;
                        // WNOHANG; guard: never waitpid(0) (= whole process group)
                        const r = if (child_pid != 0) posix.waitpid(child_pid, 1) else posix.WaitPidResult{ .pid = -1, .status = 0 };
                        if (child_pid != 0 and r.pid == child_pid) {
                            log.info(.render, "Xvfb :{?d} exited — retiring feed", .{feed.display_num});
                            feed.x_server_child = null; // already reaped; don't double-wait
                            feed.deinit();
                            feed.active = false;
                            continue;
                        }
                    }
                }

                switch (feed.backend) {
                    .xshm, .display_xshm => _ = captureXShm(feed),
                    .ffmpeg => updateFFmpeg(feed),
                    .vnc => vm.updateVnc(feed),
                }

                if (feed.dirty) {
                    if (!feed.diag_first_upload_logged) {
                        log.print("[render] first GPU upload for backend={s} {d}x{d}\n", .{ @tagName(feed.backend), feed.width, feed.height });
                        feed.diag_first_upload_logged = true;
                    }
                    if (_upd_dbg % 60 == 1) log.info(.render, "frame dirty, uploading {d}x{d}", .{ feed.width, feed.height });
                    if (!ensureTexture(feed)) {
                        log.print("[render] ensureTexture FAILED for {d}x{d}\n", .{ feed.width, feed.height });
                        log.info(.render, "ensureTexture FAILED", .{});
                        continue;
                    }
                    uploadPixels(feed);
                }

                if (!feed.active) {
                    feed.inactive_frames += 1;
                    if (feed.inactive_frames > UNLOAD_DEBOUNCE_FRAMES) {
                        feed.deinit();
                    }
                }
                feed.active = false;
            },

            .starting => {
                if (_upd_dbg % 60 == 1) log.info(.render, "feed starting, backend={s} wait={d}", .{ @tagName(feed.backend), feed.startup_wait });
                switch (feed.backend) {
                    .display_xshm => finalizeVirtualDisplay(feed),
                    .vnc => vm.finalizeVM(feed),
                    else => {},
                }
            },

            .connecting => {
                if (_upd_dbg % 60 == 1) log.info(.render, "VNC connecting, state={s}", .{@tagName(feed.vnc_state)});
                vm.updateVnc(feed);
            },

            else => {},
        }
    }
}

/// Called during paint when a node with render_src is encountered.
/// Returns true if a surface quad was queued.
var _dbg_frame: u32 = 0;

pub fn paintSurface(src: []const u8, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    _dbg_frame +%= 1;
    if (_dbg_frame % 60 == 1) log.info(.render, "paintSurface called src_len={d} rect=({d:.0},{d:.0},{d:.0},{d:.0})", .{ src.len, x, y, w, h });

    var feed = findFeed(src);
    if (feed == null) {
        log.info(.render, "no feed found, creating for src_len={d}", .{src.len});
        feed = createFeed(src, w, h);
    }
    const f = feed orelse {
        log.info(.render, "createFeed returned null", .{});
        return false;
    };
    f.active = true;

    if (f.status != .ready) {
        if (_dbg_frame % 60 == 1) log.info(.render, "feed not ready, status={s}", .{@tagName(f.status)});
        return false;
    }
    const bg = f.bind_group orelse {
        if (_dbg_frame % 60 == 1) log.info(.render, "no bind_group", .{});
        return false;
    };
    if (f.width == 0 or f.height == 0) {
        log.info(.render, "zero dimensions {d}x{d}", .{ f.width, f.height });
        return false;
    }
    if (!f.diag_first_paint_logged) {
        log.print("[render] first paint queued for backend={s} fb={d}x{d} rect=({d:.0},{d:.0},{d:.0},{d:.0})\n", .{ @tagName(f.backend), f.width, f.height, x, y, w, h });
        f.diag_first_paint_logged = true;
    }

    // display_xshm: stretch-fill (app IS the display, fill the node rect)
    // VNC/other: aspect-ratio "contain" fit (preserve source aspect ratio)
    var draw_w: f32 = undefined;
    var draw_h: f32 = undefined;
    var draw_x: f32 = undefined;
    var draw_y: f32 = undefined;

    if (f.backend == .display_xshm) {
        // Stretch-fill: app fills the entire node rect (matches Lua behavior)
        draw_w = w;
        draw_h = h;
        draw_x = x;
        draw_y = y;
    } else {
        // Contain-fit for VM/VNC/screen capture
        const vid_w: f32 = @floatFromInt(f.width);
        const vid_h: f32 = @floatFromInt(f.height);
        const vid_aspect = vid_w / vid_h;
        const box_aspect = w / h;
        if (vid_aspect > box_aspect) {
            draw_w = w;
            draw_h = w / vid_aspect;
        } else {
            draw_h = h;
            draw_w = h * vid_aspect;
        }
        draw_x = x + (w - draw_w) / 2;
        draw_y = y + (h - draw_h) / 2;
    }

    // Store node rect (for hit testing) and draw rect (for coordinate mapping)
    for (0..feed_count) |i| {
        if (std.mem.eql(u8, feeds[i].source, f.source)) {
            vm.feed_draw_rects[i] = .{
                .node = .{ .x = x, .y = y, .w = w, .h = h },
                .draw = .{ .x = draw_x, .y = draw_y, .w = draw_w, .h = draw_h },
                .fb_w = f.width,
                .fb_h = f.height,
            };
            break;
        }
    }

    images.queueQuad(draw_x, draw_y, draw_w, draw_h, opacity, bg);
    return true;
}

/// Get the status of a render surface.
pub fn getStatus(src: []const u8) ?FeedStatus {
    const f = findFeed(src) orelse return null;
    return f.status;
}

/// Check if a render source is interactive.
pub fn isInteractive(src: []const u8) bool {
    const f = findFeed(src) orelse return false;
    return f.interactive;
}

/// Get the dimensions of a render surface.
pub fn getDimensions(src: []const u8) ?struct { w: u32, h: u32 } {
    const f = findFeed(src) orelse return null;
    if (f.width > 0 and f.height > 0) return .{ .w = f.width, .h = f.height };
    return null;
}

pub const CpuFrame = struct { width: u32, height: u32, rgba: []const u8 };

/// Borrow the latest CPU RGBA frame of a live feed (top-down, stride w*4) —
/// the ML tracker input (req_2786: pose estimation reads the cam feed the
/// same place the GPU upload does). The slice ALIASES feed.pixel_buf: consume
/// it synchronously on the caller's frame, never hold it across updates.
pub fn latestCpuFrame(src: []const u8) ?CpuFrame {
    const f = findFeed(src) orelse return null;
    const buf = f.pixel_buf orelse return null;
    if (f.width == 0 or f.height == 0 or f.status != .ready) return null;
    const need = @as(usize, f.width) * @as(usize, f.height) * 4;
    if (buf.len < need) return null;
    return .{ .width = f.width, .height = f.height, .rgba = buf[0..need] };
}

/// Suspend / resume the feed's subprocesses via SIGSTOP / SIGCONT. Idempotent
/// — only acts on transitions. Skips no-op when feed doesn't exist yet.
/// Sends to the whole process group via negative pid so any child of qemu
/// (its monitor thread, etc.) gets the signal too.
pub fn setSuspended(src: []const u8, suspended: bool) void {
    const f = findFeed(src) orelse return;
    if (f.suspended == suspended) return;
    const sig: posix.SIG = if (suspended) .STOP else .CONT;
    const pids = [_]?std.process.Child{ f.qemu_child, f.x_server_child, f.app_child };
    for (pids) |maybe_child| {
        const child = maybe_child orelse continue;
        const child_pid = child.id orelse continue;
        posix.kill(child_pid, sig) catch |err| {
            log.print("[render] setSuspended kill pid={d} sig={d} failed: {s}\n", .{ child_pid, @intFromEnum(sig), @errorName(err) });
        };
    }
    f.suspended = suspended;
    log.print("[render] feed src=\"{s}\" {s}\n", .{ src, if (suspended) "SUSPENDED" else "RESUMED" });
}

// ════════════════════════════════════════════════════════════════════════

// Re-exports from render_surfaces_vm.zig (preserves public API for engine.zig)
pub const handleMouseDown = vm.handleMouseDown;
pub const handleMouseUp = vm.handleMouseUp;
pub const handleMouseMotion = vm.handleMouseMotion;
pub const handleKeyDown = vm.handleKeyDown;
pub const handleKeyUp = vm.handleKeyUp;
pub const handleTextInput = vm.handleTextInput;
pub const hasFocus = vm.hasFocus;
