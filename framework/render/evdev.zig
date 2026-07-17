//! evdev → SDL event bridge for KMS / no-display-server mode.
//!
//! Under the dummy SDL video driver there is no windowing backend to deliver
//! input, so we read the raw kernel input devices (/dev/input/event*) directly
//! and re-inject them as SDL events via SDL_PushEvent. The engine's normal
//! event switch (engine.zig) then routes them unchanged — hover, hit-test,
//! scrollbars, JS handlers all work exactly as in windowed mode.
//!
//! Pointer handling covers both shapes QEMU can hand us: virtio-tablet
//! (absolute, EV_ABS) and a plain mouse (relative, EV_REL). Buttons map to the
//! SDL button indices. Keyboard is intentionally out of scope here (milestone:
//! a clickable desktop); text input is a follow-up.

const builtin = @import("builtin");
const std = @import("std");
const c = @import("../c.zig").imports;

// evdev reads raw Linux kernel input devices (/dev/input/event*) via
// <linux/input.h> — Linux-only. Off Linux the whole implementation lives in a
// comptime-dead branch so the @cImport never runs; the engine only uses evdev
// under the dummy SDL video driver (kms mode), which is itself Linux-only.
const is_linux = builtin.os.tag == .linux;

pub fn deviceCount() usize {
    return if (is_linux) Impl.deviceCount() else 0;
}
pub fn mouseX() f32 {
    return if (is_linux) Impl.mouseX() else 0;
}
pub fn mouseY() f32 {
    return if (is_linux) Impl.mouseY() else 0;
}
pub fn init(window: *c.SDL_Window, width: f32, height: f32) void {
    if (is_linux) Impl.init(window, width, height);
}
pub fn poll() void {
    if (is_linux) Impl.poll();
}
pub fn deinit() void {
    if (is_linux) Impl.deinit();
}

const Impl = if (is_linux) struct {
    const ie = @cImport({
        @cInclude("linux/input.h");
        @cInclude("linux/input-event-codes.h");
    });

    const linux = std.os.linux;

    const MAX_DEVS = 32;

const Device = struct {
    fd: i32,
    abs: bool, // absolute pointer (tablet) vs relative (mouse)
    ax_min: f32 = 0,
    ax_max: f32 = 32767,
    ay_min: f32 = 0,
    ay_max: f32 = 32767,
    // per-report accumulator
    pend_x: ?i32 = null,
    pend_y: ?i32 = null,
    rel_dx: f32 = 0,
    rel_dy: f32 = 0,
    moved: bool = false,
};

var g_devs: [MAX_DEVS]Device = undefined;
var g_ndev: usize = 0;
var g_win_id: c.SDL_WindowID = 0;
var g_w: f32 = 0;
var g_h: f32 = 0;
var g_mx: f32 = 0;
var g_my: f32 = 0;
var g_btn_mask: u32 = 0;
var g_motion_logged: bool = false;

pub fn deviceCount() usize {
    return g_ndev;
}
pub fn mouseX() f32 {
    return g_mx;
}
pub fn mouseY() f32 {
    return g_my;
}

/// _IOR('E', 0x40 + abs, struct input_absinfo) — the EVIOCGABS macro takes an
/// argument so translate-c can't expose it; build the request number by hand.
fn eviocgabs(abs: u32) u32 {
    const size: u32 = @sizeOf(ie.struct_input_absinfo);
    return (2 << 30) | (size << 16) | (0x45 << 8) | (0x40 + abs);
}

pub fn init(window: *c.SDL_Window, width: f32, height: f32) void {
    g_win_id = c.SDL_GetWindowID(window);
    g_w = width;
    g_h = height;
    g_mx = width / 2;
    g_my = height / 2;
    g_ndev = 0;

    var path_buf: [32]u8 = undefined;
    var n: u8 = 0;
    while (n < 64 and g_ndev < MAX_DEVS) : (n += 1) {
        const path = std.fmt.bufPrintZ(&path_buf, "/dev/input/event{d}", .{n}) catch continue;
        const rc = linux.open(path, .{ .ACCMODE = .RDONLY, .NONBLOCK = true, .CLOEXEC = true }, 0);
        if (linux.errno(rc) != .SUCCESS) continue;
        const fd: i32 = @intCast(rc);

        // Absolute pointer? Probe the X/Y axis ranges.
        var dev = Device{ .fd = fd, .abs = false };
        var ax: ie.struct_input_absinfo = undefined;
        var ay: ie.struct_input_absinfo = undefined;
        const got_x = linux.ioctl(fd, eviocgabs(ie.ABS_X), @intFromPtr(&ax));
        const got_y = linux.ioctl(fd, eviocgabs(ie.ABS_Y), @intFromPtr(&ay));
        if (linux.errno(got_x) == .SUCCESS and linux.errno(got_y) == .SUCCESS and ax.maximum > ax.minimum) {
            dev.abs = true;
            dev.ax_min = @floatFromInt(ax.minimum);
            dev.ax_max = @floatFromInt(ax.maximum);
            dev.ay_min = @floatFromInt(ay.minimum);
            dev.ay_max = @floatFromInt(ay.maximum);
        }
        std.debug.print("[evdev] opened {s} abs={}\n", .{ path, dev.abs });
        g_devs[g_ndev] = dev;
        g_ndev += 1;
    }
    std.debug.print("[evdev] {d} input device(s)\n", .{g_ndev});
}

/// Drain all pending input and push synthesized SDL events. Call once per
/// loop iteration, before SDL_PollEvent.
pub fn poll() void {
    if (g_ndev == 0) return;
    const ev_size = @sizeOf(ie.struct_input_event);
    var buf: [64 * @sizeOf(ie.struct_input_event)]u8 = undefined;

    for (g_devs[0..g_ndev]) |*dev| {
        while (true) {
            const rc = linux.read(dev.fd, &buf, buf.len);
            const e = linux.errno(rc);
            if (e != .SUCCESS) break; // EAGAIN / EWOULDBLOCK — nothing more
            const got: usize = rc;
            if (got < ev_size) break;
            const count = got / ev_size;
            var i: usize = 0;
            while (i < count) : (i += 1) {
                const ev: *const ie.struct_input_event = @ptrCast(@alignCast(&buf[i * ev_size]));
                handleEvent(dev, ev.type, ev.code, ev.value);
            }
            if (got < ev_size) break;
        }
    }
}

fn handleEvent(dev: *Device, etype: u16, code: u16, value: i32) void {
    switch (etype) {
        ie.EV_ABS => {
            if (code == ie.ABS_X) {
                dev.pend_x = value;
                dev.moved = true;
            } else if (code == ie.ABS_Y) {
                dev.pend_y = value;
                dev.moved = true;
            }
        },
        ie.EV_REL => {
            if (code == ie.REL_X) {
                dev.rel_dx += @floatFromInt(value);
                dev.moved = true;
            } else if (code == ie.REL_Y) {
                dev.rel_dy += @floatFromInt(value);
                dev.moved = true;
            }
        },
        ie.EV_KEY => {
            const sdl_button: u8 = switch (code) {
                ie.BTN_LEFT => c.SDL_BUTTON_LEFT,
                ie.BTN_RIGHT => c.SDL_BUTTON_RIGHT,
                ie.BTN_MIDDLE => c.SDL_BUTTON_MIDDLE,
                else => return, // keyboard / other keys: out of scope here
            };
            pushButton(sdl_button, value != 0);
        },
        ie.EV_SYN => {
            if (code == ie.SYN_REPORT and dev.moved) flushMotion(dev);
        },
        else => {},
    }
}

fn flushMotion(dev: *Device) void {
    var nx = g_mx;
    var ny = g_my;
    if (dev.abs) {
        if (dev.pend_x) |vx| nx = (@as(f32, @floatFromInt(vx)) - dev.ax_min) / (dev.ax_max - dev.ax_min) * g_w;
        if (dev.pend_y) |vy| ny = (@as(f32, @floatFromInt(vy)) - dev.ay_min) / (dev.ay_max - dev.ay_min) * g_h;
    } else {
        nx = g_mx + dev.rel_dx;
        ny = g_my + dev.rel_dy;
    }
    nx = std.math.clamp(nx, 0, g_w - 1);
    ny = std.math.clamp(ny, 0, g_h - 1);

    const dx = nx - g_mx;
    const dy = ny - g_my;
    g_mx = nx;
    g_my = ny;
    dev.pend_x = null;
    dev.pend_y = null;
    dev.rel_dx = 0;
    dev.rel_dy = 0;
    dev.moved = false;

    var sev: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    sev.type = c.SDL_EVENT_MOUSE_MOTION;
    sev.motion.windowID = g_win_id;
    sev.motion.state = g_btn_mask;
    sev.motion.x = g_mx;
    sev.motion.y = g_my;
    sev.motion.xrel = dx;
    sev.motion.yrel = dy;
    const pushed = c.SDL_PushEvent(&sev);
    if (!g_motion_logged) {
        g_motion_logged = true;
        std.debug.print("[evdev] first motion x={d:.0} y={d:.0} pushed={} winID={d}\n", .{ g_mx, g_my, pushed, g_win_id });
    }
}

fn pushButton(button: u8, down: bool) void {
    const mask: u32 = @as(u32, 1) << @intCast(button - 1);
    if (down) g_btn_mask |= mask else g_btn_mask &= ~mask;

    var sev: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    sev.type = if (down) c.SDL_EVENT_MOUSE_BUTTON_DOWN else c.SDL_EVENT_MOUSE_BUTTON_UP;
    sev.button.windowID = g_win_id;
    sev.button.button = button;
    sev.button.down = down;
    sev.button.clicks = 1;
    sev.button.x = g_mx;
    sev.button.y = g_my;
    const pushed = c.SDL_PushEvent(&sev);
    std.debug.print("[evdev] button {d} down={} at x={d:.0} y={d:.0} pushed={}\n", .{ button, down, g_mx, g_my, pushed });
}

pub fn deinit() void {
    for (g_devs[0..g_ndev]) |dev| _ = linux.close(dev.fd);
    g_ndev = 0;
}
} else struct {};
