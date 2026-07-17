//! Window geometry persistence — save/restore window position, size, and
//! maximized state.
//!
//! Saves to /tmp/tsz-geometry-<app-name>.dat as 20 bytes
//! (4 x i32: x, y, width, height; 1 x u32: maximized flag).
//!
//! The (x,y,w,h) we persist is always the *windowed* (un-maximized) rect —
//! never the maximized/fullscreen rect. SDL3 has no API to query the WM's
//! "restore-to" geometry, so we track it ourselves: every save() while the
//! window is in normal state updates a cached `last_windowed` rect; saves
//! while maximized/fullscreen reuse that cache and only flip the flag.
//!
//! Why: if we wrote the maximized rect literally, the next launch would
//! create a normal borderless window whose bounds exactly match the
//! monitor's DisplayBounds. Most Linux compositors then treat that window
//! as implicitly tiled and refuse drag/move requests, leaving the window
//! permanently stuck.
//!
//! Anti-race: blocks saves for 2s after restore so SDL_MaximizeWindow's
//! resize callbacks can't overwrite the rect we just loaded.

const std = @import("std");
const host_io = @import("../host_io.zig");
const c = @import("../c.zig").imports;

pub const WindowGeometry = extern struct {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    maximized: u32,
};

const SAVE_BLOCK_MS: u64 = 2000;
var save_blocked_until: u64 = 0;

var path_buf: [256]u8 = undefined;
var path_len: usize = 0;

var last_windowed: WindowGeometry = undefined;
var last_windowed_set: bool = false;

pub fn init(app_name: []const u8) void {
    const prefix = "/tmp/tsz-geometry-";
    const suffix = ".dat";
    const total = prefix.len + app_name.len + suffix.len;
    if (total >= path_buf.len) return;
    @memcpy(path_buf[0..prefix.len], prefix);
    @memcpy(path_buf[prefix.len .. prefix.len + app_name.len], app_name);
    @memcpy(path_buf[prefix.len + app_name.len .. total], suffix);
    path_len = total;
}

fn getPath() [:0]const u8 {
    if (path_len == 0) return "/tmp/tsz-geometry.dat";
    path_buf[path_len] = 0;
    return path_buf[0..path_len :0];
}

const MAX_OR_FULL: u64 = c.SDL_WINDOW_MAXIMIZED | c.SDL_WINDOW_FULLSCREEN;

pub fn save(window: *c.SDL_Window) void {
    const now = c.SDL_GetTicks();
    if (now < save_blocked_until) return;

    const flags = c.SDL_GetWindowFlags(window);
    const is_max = (flags & MAX_OR_FULL) != 0;

    var geom: WindowGeometry = undefined;

    if (is_max) {
        if (!last_windowed_set) return;
        geom = last_windowed;
        geom.maximized = 1;
    } else {
        var x: c_int = undefined;
        var y: c_int = undefined;
        _ = c.SDL_GetWindowPosition(window, &x, &y);

        var w: c_int = undefined;
        var h: c_int = undefined;
        _ = c.SDL_GetWindowSize(window, &w, &h);

        geom = .{
            .x = @intCast(x),
            .y = @intCast(y),
            .width = @intCast(w),
            .height = @intCast(h),
            .maximized = 0,
        };
        last_windowed = geom;
        last_windowed_set = true;
    }

    const bytes: *const [@sizeOf(WindowGeometry)]u8 = @ptrCast(&geom);
    const file = std.Io.Dir.createFileAbsolute(host_io.io(), getPath(), .{}) catch return;
    defer file.close(host_io.io());
    file.writeStreamingAll(host_io.io(), bytes) catch {};
}

pub fn load() ?WindowGeometry {
    const file = std.Io.Dir.openFileAbsolute(host_io.io(), getPath(), .{}) catch return null;
    defer file.close(host_io.io());

    var bytes: [@sizeOf(WindowGeometry)]u8 = undefined;
    const n = file.readPositionalAll(host_io.io(), &bytes, 0) catch return null;
    if (n < @sizeOf(WindowGeometry)) return null;

    const geom: *const WindowGeometry = @ptrCast(@alignCast(&bytes));
    const g = geom.*;

    if (g.width < 100 or g.height < 100) return null;
    if (g.width > 10000 or g.height > 10000) return null;

    var num_displays: c_int = 0;
    const displays = c.SDL_GetDisplays(&num_displays);
    if (displays == null or num_displays <= 0) {
        last_windowed = g;
        last_windowed.maximized = 0;
        last_windowed_set = true;
        return g;
    }
    defer c.SDL_free(displays);

    var on_screen = false;
    var i: c_int = 0;
    while (i < num_displays) : (i += 1) {
        var bounds: c.SDL_Rect = undefined;
        if (c.SDL_GetDisplayBounds(displays[@intCast(i)], &bounds)) {
            const cx = g.x + @divTrunc(g.width, 2);
            const cy = g.y + @divTrunc(g.height, 2);
            if (cx >= bounds.x and cx < bounds.x + bounds.w and
                cy >= bounds.y and cy < bounds.y + bounds.h)
            {
                on_screen = true;
                break;
            }
        }
    }

    if (!on_screen) return null;

    last_windowed = g;
    last_windowed.maximized = 0;
    last_windowed_set = true;
    return g;
}

pub fn blockSaves() void {
    save_blocked_until = c.SDL_GetTicks() + SAVE_BLOCK_MS;
}
