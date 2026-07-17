//! Direct DRM/KMS dumb-buffer scanout — reactjit AS the display server.
//!
//! No X, no Wayland, no compositor, no libdrm. We open /dev/dri/cardN and
//! drive the kernel modesetting UAPI with raw ioctls (the structs and ioctl
//! numbers come from the header-only <drm/drm.h> + <drm/drm_mode.h>, so there
//! is no link-time OR run-time libdrm dependency).
//!
//! Lifecycle:
//!   kms.init()                  → open card, pick connector/crtc/mode,
//!                                 allocate + map a dumb framebuffer, scan it out
//!   kms.width()/kms.height()    → the chosen mode size (engine sizes the UI to it)
//!   kms.present(px, w, h, pitch)→ blit a BGRA8 readback into the scanout buffer
//!   kms.deinit()                → restore the saved CRTC, unmap, free, close
//!
//! Pixel format: the wgpu offscreen texture is bgra8_unorm, i.e. bytes
//! [B,G,R,A] per pixel. The dumb buffer is created as XRGB8888 (depth 24,
//! bpp 32), whose 32-bit little-endian word is 0x00RRGGBB == bytes [B,G,R,X].
//! The first three bytes line up, so presenting is a plain per-row memcpy.

const builtin = @import("builtin");
const std = @import("std");
const log = @import("../diag/log.zig");

// DRM/KMS is a Linux-only kernel interface (<drm/drm.h> ships only on Linux).
// On every other platform the whole implementation lives in a comptime-dead
// branch so the @cImport never runs, and the public API degrades to no-ops:
// kms scanout is never active off Linux (the engine only enters kms_mode on a
// bare Linux VT). Public dispatchers forward to Impl on Linux, stub elsewhere.
const is_linux = builtin.os.tag == .linux;

pub fn isActive() bool {
    return if (is_linux) Impl.isActive() else false;
}
pub fn width() u32 {
    return if (is_linux) Impl.width() else 0;
}
pub fn height() u32 {
    return if (is_linux) Impl.height() else 0;
}
pub fn init() !void {
    return if (is_linux) Impl.init() else error.NoUsableCard;
}
pub fn present(src: [*]const u8, src_w: u32, src_h: u32, src_pitch: u32) void {
    if (is_linux) Impl.present(src, src_w, src_h, src_pitch);
}
pub fn deinit() void {
    if (is_linux) Impl.deinit();
}

const Impl = if (is_linux) struct {
    const c = @cImport({
        @cInclude("drm/drm.h");
        @cInclude("drm/drm_mode.h");
    });

    const linux = std.os.linux;

const MAX_IDS = 64; // connectors / crtcs / encoders per card — generous
const MAX_MODES = 256;

const Display = struct {
    fd: i32,
    width: u32,
    height: u32,
    pitch: u32, // dst stride in bytes
    size: u64,
    handle: u32,
    fb_id: u32,
    crtc_id: u32,
    conn_id: u32,
    mode: c.struct_drm_mode_modeinfo,
    had_saved: bool,
    saved: c.struct_drm_mode_crtc,
    map: []align(std.heap.page_size_min) u8,
};

var g_display: ?Display = null;

/// Raw ioctl wrapper — DRM ioctl numbers are u32 (the _IOWR direction bit
/// sets the top bit, so they exceed i32). Retries on EINTR/EAGAIN.
fn ioctl(fd: i32, request: u32, arg: usize) !void {
    while (true) {
        const rc = linux.ioctl(fd, request, arg);
        switch (linux.errno(rc)) {
            .SUCCESS => return,
            .INTR, .AGAIN => continue,
            else => |e| {
                log.print("[kms] ioctl 0x{x} failed: {s}\n", .{ request, @tagName(e) });
                return error.IoctlFailed;
            },
        }
    }
}

pub fn isActive() bool {
    return g_display != null;
}

pub fn width() u32 {
    return if (g_display) |d| d.width else 0;
}

pub fn height() u32 {
    return if (g_display) |d| d.height else 0;
}

/// Open the first DRM card that has a connected connector with a usable mode,
/// allocate a dumb framebuffer, and scan it out. Returns the chosen size.
pub fn init() !void {
    if (g_display != null) return;

    var path_buf: [32]u8 = undefined;
    var card: u8 = 0;
    while (card < 8) : (card += 1) {
        const path = std.fmt.bufPrintZ(&path_buf, "/dev/dri/card{d}", .{card}) catch continue;
        const fd = openCard(path) orelse continue;
        if (setupCard(fd)) {
            log.print("[kms] scanning out on {s}: {d}x{d}\n", .{ path, Impl.width(), Impl.height() });
            return;
        } else |err| {
            log.print("[kms] {s}: {s}\n", .{ path, @errorName(err) });
            _ = linux.close(fd);
        }
    }
    return error.NoUsableCard;
}

fn openCard(path: [:0]const u8) ?i32 {
    const rc = linux.open(path, .{ .ACCMODE = .RDWR, .CLOEXEC = true }, 0);
    if (linux.errno(rc) != .SUCCESS) return null;
    return @intCast(rc);
}

fn setupCard(fd: i32) !void {
    // Become DRM master so SETCRTC is permitted. On a bare VT with no
    // compositor this normally succeeds (or we are already implicit master).
    ioctl(fd, c.DRM_IOCTL_SET_MASTER, 0) catch {};

    // ── Resources: connector + crtc id arrays (two-pass count→fill) ──
    var conn_ids: [MAX_IDS]u32 = undefined;
    var crtc_ids: [MAX_IDS]u32 = undefined;
    var res = std.mem.zeroes(c.struct_drm_mode_card_res);
    try ioctl(fd, c.DRM_IOCTL_MODE_GETRESOURCES, @intFromPtr(&res));
    const n_conn = @min(res.count_connectors, MAX_IDS);
    const n_crtc = @min(res.count_crtcs, MAX_IDS);
    if (n_conn == 0 or n_crtc == 0) return error.NoOutputs;
    res.connector_id_ptr = @intFromPtr(&conn_ids);
    res.crtc_id_ptr = @intFromPtr(&crtc_ids);
    res.count_connectors = n_conn;
    res.count_crtcs = n_crtc;
    res.count_fbs = 0;
    res.count_encoders = 0;
    try ioctl(fd, c.DRM_IOCTL_MODE_GETRESOURCES, @intFromPtr(&res));

    // ── Find a connected connector with at least one mode ──
    var modes: [MAX_MODES]c.struct_drm_mode_modeinfo = undefined;
    var chosen_conn: u32 = 0;
    var chosen_enc: u32 = 0;
    var chosen_mode: c.struct_drm_mode_modeinfo = undefined;
    var found = false;
    for (conn_ids[0..n_conn]) |cid| {
        var conn = std.mem.zeroes(c.struct_drm_mode_get_connector);
        conn.connector_id = cid;
        try ioctl(fd, c.DRM_IOCTL_MODE_GETCONNECTOR, @intFromPtr(&conn));
        if (conn.connection != 1 or conn.count_modes == 0) continue; // 1 == connected
        const n_modes = @min(conn.count_modes, MAX_MODES);
        conn.modes_ptr = @intFromPtr(&modes);
        conn.count_modes = n_modes;
        conn.count_props = 0;
        conn.count_encoders = 0;
        try ioctl(fd, c.DRM_IOCTL_MODE_GETCONNECTOR, @intFromPtr(&conn));
        chosen_conn = cid;
        chosen_enc = conn.encoder_id;
        chosen_mode = modes[0]; // first == preferred
        found = true;
        break;
    }
    if (!found) return error.NoConnectedDisplay;

    // ── Resolve a CRTC: prefer the connector's current encoder's crtc ──
    var crtc_id: u32 = 0;
    if (chosen_enc != 0) {
        var enc = std.mem.zeroes(c.struct_drm_mode_get_encoder);
        enc.encoder_id = chosen_enc;
        if (ioctl(fd, c.DRM_IOCTL_MODE_GETENCODER, @intFromPtr(&enc))) {
            crtc_id = enc.crtc_id;
        } else |_| {}
    }
    if (crtc_id == 0) crtc_id = crtc_ids[0];

    const mode_w: u32 = chosen_mode.hdisplay;
    const mode_h: u32 = chosen_mode.vdisplay;

    // ── Dumb buffer (XRGB8888) ──
    var create = std.mem.zeroes(c.struct_drm_mode_create_dumb);
    create.width = mode_w;
    create.height = mode_h;
    create.bpp = 32;
    try ioctl(fd, c.DRM_IOCTL_MODE_CREATE_DUMB, @intFromPtr(&create));

    var add = std.mem.zeroes(c.struct_drm_mode_fb_cmd);
    add.width = mode_w;
    add.height = mode_h;
    add.pitch = create.pitch;
    add.bpp = 32;
    add.depth = 24;
    add.handle = create.handle;
    try ioctl(fd, c.DRM_IOCTL_MODE_ADDFB, @intFromPtr(&add));

    var mapreq = std.mem.zeroes(c.struct_drm_mode_map_dumb);
    mapreq.handle = create.handle;
    try ioctl(fd, c.DRM_IOCTL_MODE_MAP_DUMB, @intFromPtr(&mapreq));

    const map = std.posix.mmap(
        null,
        create.size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .SHARED },
        fd,
        mapreq.offset,
    ) catch return error.MmapFailed;
    @memset(map, 0);

    // ── Save current CRTC so we can restore the console on exit ──
    var saved = std.mem.zeroes(c.struct_drm_mode_crtc);
    saved.crtc_id = crtc_id;
    const had_saved = if (ioctl(fd, c.DRM_IOCTL_MODE_GETCRTC, @intFromPtr(&saved))) true else |_| false;

    // ── Scan out our framebuffer ──
    var set = std.mem.zeroes(c.struct_drm_mode_crtc);
    set.crtc_id = crtc_id;
    set.fb_id = add.fb_id;
    set.set_connectors_ptr = @intFromPtr(&chosen_conn);
    set.count_connectors = 1;
    set.mode = chosen_mode;
    set.mode_valid = 1;
    try ioctl(fd, c.DRM_IOCTL_MODE_SETCRTC, @intFromPtr(&set));

    g_display = .{
        .fd = fd,
        .width = mode_w,
        .height = mode_h,
        .pitch = create.pitch,
        .size = create.size,
        .handle = create.handle,
        .fb_id = add.fb_id,
        .crtc_id = crtc_id,
        .conn_id = chosen_conn,
        .mode = chosen_mode,
        .had_saved = had_saved,
        .saved = saved,
        .map = map,
    };
}

/// Blit a BGRA8 source (with `src_pitch` bytes per row, e.g. wgpu's
/// 256-aligned readback) into the scanout buffer. Per-row copy because the
/// source and destination strides differ.
pub fn present(src: [*]const u8, src_w: u32, src_h: u32, src_pitch: u32) void {
    const d = g_display orelse return;
    const rows = @min(src_h, d.height);
    const row_bytes = @min(src_w * 4, d.pitch);
    var y: u32 = 0;
    while (y < rows) : (y += 1) {
        const s = src + y * src_pitch;
        const dst = d.map.ptr + y * d.pitch;
        @memcpy(dst[0..row_bytes], s[0..row_bytes]);
    }

    // Shadow-buffer drivers (virtio-gpu, qxl, vmwgfx, simpledrm) do NOT push
    // CPU writes to the scanout resource on their own — they need a dirty
    // notification. num_clips=0 marks the whole framebuffer dirty, which makes
    // virtio-gpu transfer our blit to the host and flush it. Without this the
    // screen only ever shows the initial SETCRTC contents. Harmless no-op (we
    // swallow the error) on drivers that scan the buffer out directly.
    var dirty = std.mem.zeroes(c.struct_drm_mode_fb_dirty_cmd);
    dirty.fb_id = d.fb_id;
    ioctl(d.fd, c.DRM_IOCTL_MODE_DIRTYFB, @intFromPtr(&dirty)) catch {};
}

pub fn deinit() void {
    const d = g_display orelse return;
    // Restore the console's original CRTC if we captured one.
    if (d.had_saved) {
        var restore = d.saved;
        restore.set_connectors_ptr = @intFromPtr(&d.conn_id);
        restore.count_connectors = 1;
        ioctl(d.fd, c.DRM_IOCTL_MODE_SETCRTC, @intFromPtr(&restore)) catch {};
    }
    std.posix.munmap(d.map);
    var rm: u32 = d.fb_id;
    ioctl(d.fd, c.DRM_IOCTL_MODE_RMFB, @intFromPtr(&rm)) catch {};
    var destroy = std.mem.zeroes(c.struct_drm_mode_destroy_dumb);
    destroy.handle = d.handle;
    ioctl(d.fd, c.DRM_IOCTL_MODE_DESTROY_DUMB, @intFromPtr(&destroy)) catch {};
    ioctl(d.fd, c.DRM_IOCTL_DROP_MASTER, 0) catch {};
    _ = linux.close(d.fd);
    g_display = null;
}
} else struct {};
