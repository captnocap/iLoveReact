//! Render surfaces — VM/VNC protocol and input forwarding.
//!
//! Split from render_surfaces.zig. Contains:
//!   - VNC RFB client (handshake, framebuffer updates)
//!   - QEMU VM management (spawn, VNC connect)
//!   - Input forwarding (mouse, keyboard → VNC/XTest/xdotool)

const std = @import("std");
const transport = @import("../net/transport.zig");
const log = @import("../diag/log.zig");
const c = @import("../c.zig").imports;
const child_teardown = @import("child_teardown.zig");

const parent = @import("render_surfaces.zig");
const Feed = parent.Feed;
const VncState = parent.VncState;
const X11Fns = parent.X11Fns;
const XTestFns = parent.XTestFns;
const Display = parent.Display;
const XID = parent.XID;

const page_alloc = std.heap.page_allocator;

// ════════════════════════════════════════════════════════════════════════
// VNC RFB client (for VM capture and direct VNC)
// ════════════════════════════════════════════════════════════════════════

pub fn u16be(val: u16) [2]u8 {
    return .{ @intCast(val >> 8), @intCast(val & 0xFF) };
}

pub fn u32be(val: u32) [4]u8 {
    return .{
        @intCast((val >> 24) & 0xFF),
        @intCast((val >> 16) & 0xFF),
        @intCast((val >> 8) & 0xFF),
        @intCast(val & 0xFF),
    };
}

pub fn readU16be(buf: []const u8) u16 {
    if (buf.len < 2) return 0;
    return (@as(u16, buf[0]) << 8) | @as(u16, buf[1]);
}

pub fn readU32be(buf: []const u8) u32 {
    if (buf.len < 4) return 0;
    return (@as(u32, buf[0]) << 24) | (@as(u32, buf[1]) << 16) | (@as(u32, buf[2]) << 8) | @as(u32, buf[3]);
}

const MAX_VNC_RX_BYTES = 64 * 1024 * 1024;
const VNC_DRAIN_CHUNK_BYTES = 16 * 1024;
const MAX_VNC_DRAINS_PER_TICK = 512;

fn failVnc(feed: *Feed, message: []const u8) void {
    log.info(.render, "VNC failed: {s}", .{message});
    feed.closeVnc();
    feed.vnc_state = .failed;
    feed.status = .@"error";
    feed.vnc_request_in_flight = false;
}

fn consumeRx(feed: *Feed, count: usize) void {
    std.debug.assert(count <= feed.vnc_rx.items.len);
    const remaining = feed.vnc_rx.items.len - count;
    @memmove(feed.vnc_rx.items[0..remaining], feed.vnc_rx.items[count..]);
    feed.vnc_rx.items.len = remaining;
}

/// Harvest bytes completed by the native Io network task. The task blocks on
/// the stream; the render thread only drains its bounded queue and therefore
/// never performs a raw readiness poll or waits for a partial VNC frame.
fn drainVnc(feed: *Feed) bool {
    const pump = if (feed.vnc_pump) |*value| value else return false;
    var scratch: [VNC_DRAIN_CHUNK_BYTES]u8 = undefined;
    var drains: usize = 0;
    while (drains < MAX_VNC_DRAINS_PER_TICK) : (drains += 1) {
        switch (pump.drain(&scratch)) {
            .empty => return true,
            .data => |n| {
                if (feed.vnc_rx.items.len + n > MAX_VNC_RX_BYTES) {
                    failVnc(feed, "receive buffer limit exceeded");
                    return false;
                }
                feed.vnc_rx.appendSlice(page_alloc, scratch[0..n]) catch {
                    failVnc(feed, "out of memory buffering frame");
                    return false;
                };
            },
            .closed => {
                failVnc(feed, "server closed connection");
                return false;
            },
            .failed => |err| {
                log.info(.render, "VNC read failed: {s}", .{@errorName(err)});
                failVnc(feed, "network read failed");
                return false;
            },
        }
    }
    return true;
}

fn vncWrite(feed: *Feed, data: []const u8) bool {
    const pump = if (feed.vnc_pump) |*value| value else return false;
    pump.send(data) catch |err| {
        log.info(.render, "VNC write failed: {s}", .{@errorName(err)});
        failVnc(feed, "network write failed");
        return false;
    };
    return true;
}

pub fn connectVnc(io: std.Io, host_str: []const u8, port: u16) ?transport.StreamPump {
    const stream = transport.connectHost(io, host_str, port) catch return null;
    return transport.StreamPump.init(page_alloc, io, stream) catch {
        stream.close(io);
        return null;
    };
}

fn invalidateTexture(feed: *Feed) void {
    if (feed.bind_group) |bg| bg.release();
    if (feed.sampler) |s| s.release();
    if (feed.texture_view) |tv| tv.release();
    if (feed.texture) |t| t.release();
    feed.bind_group = null;
    feed.sampler = null;
    feed.texture_view = null;
    feed.texture = null;
}

fn resizeFramebuffer(feed: *Feed, width: u32, height: u32) bool {
    if (width == 0 or height == 0) return false;
    if (width == feed.width and height == feed.height) return true;
    const new_pixels = page_alloc.alloc(u8, @as(usize, width) * @as(usize, height) * 4) catch return false;
    if (feed.pixel_buf) |old| page_alloc.free(old);
    feed.pixel_buf = new_pixels;
    feed.width = width;
    feed.height = height;
    feed.vnc_fb_width = @intCast(width);
    feed.vnc_fb_height = @intCast(height);
    invalidateTexture(feed);
    return true;
}

/// Parse and apply one complete FramebufferUpdate transaction. Nothing is
/// consumed until every rectangle (including all RAW pixels) is buffered, so
/// arbitrary TCP segmentation cannot desynchronize the protocol state.
fn applyFramebufferUpdate(feed: *Feed) bool {
    const bytes = feed.vnc_rx.items;
    if (bytes.len < 4) return false;
    if (bytes[0] != 0) {
        failVnc(feed, "unsupported server message");
        return false;
    }

    const num_rects = readU16be(bytes[2..4]);
    var scan: usize = 4;
    var rect_i: u16 = 0;
    while (rect_i < num_rects) : (rect_i += 1) {
        if (bytes.len < scan + 12) return false;
        const rw = readU16be(bytes[scan + 4 .. scan + 6]);
        const rh = readU16be(bytes[scan + 6 .. scan + 8]);
        const encoding = readU32be(bytes[scan + 8 .. scan + 12]);
        scan += 12;
        switch (encoding) {
            0 => {
                const pixel_bytes = @as(usize, rw) * @as(usize, rh) * 4;
                if (bytes.len < scan + pixel_bytes) return false;
                scan += pixel_bytes;
            },
            0xFFFFFF21 => {}, // DesktopSize has no payload.
            else => {
                log.print("[render-vm] unsupported VNC encoding 0x{x}\n", .{encoding});
                failVnc(feed, "unsupported framebuffer encoding");
                return false;
            },
        }
    }

    if (!feed.diag_first_frame_logged)
        log.print("[render-vm] FramebufferUpdate received: {d} rects\n", .{num_rects});

    var cursor: usize = 4;
    rect_i = 0;
    while (rect_i < num_rects) : (rect_i += 1) {
        const rx: usize = readU16be(bytes[cursor .. cursor + 2]);
        const ry: usize = readU16be(bytes[cursor + 2 .. cursor + 4]);
        const rw = readU16be(bytes[cursor + 4 .. cursor + 6]);
        const rh = readU16be(bytes[cursor + 6 .. cursor + 8]);
        const encoding = readU32be(bytes[cursor + 8 .. cursor + 12]);
        cursor += 12;

        if (encoding == 0xFFFFFF21) {
            const new_w: u32 = rw;
            const new_h: u32 = rh;
            log.print("[render-vm] DesktopSize: framebuffer resize {d}x{d} → {d}x{d}\n", .{ feed.width, feed.height, new_w, new_h });
            if (!resizeFramebuffer(feed, new_w, new_h)) {
                failVnc(feed, "framebuffer resize failed");
                return false;
            }
            continue;
        }

        const rect_w: usize = rw;
        const rect_h: usize = rh;
        const row_bytes = rect_w * 4;
        const pixel_bytes = row_bytes * rect_h;
        const pixels = bytes[cursor .. cursor + pixel_bytes];
        cursor += pixel_bytes;
        const framebuffer = feed.pixel_buf orelse {
            failVnc(feed, "missing framebuffer allocation");
            return false;
        };
        const fb_w: usize = feed.width;
        const fb_h: usize = feed.height;
        if (rx + rect_w > fb_w or ry + rect_h > fb_h) {
            failVnc(feed, "rectangle outside framebuffer");
            return false;
        }
        for (0..rect_h) |row| {
            const source_offset = row * row_bytes;
            const dest_offset = ((ry + row) * fb_w + rx) * 4;
            @memcpy(framebuffer[dest_offset .. dest_offset + row_bytes], pixels[source_offset .. source_offset + row_bytes]);
        }
        feed.dirty = true;
        if (!feed.diag_first_frame_logged) {
            log.print("[render-vm] first VNC frame received: {d}x{d} ({d} bytes)\n", .{ rw, rh, pixel_bytes });
            feed.diag_first_frame_logged = true;
        }
    }

    consumeRx(feed, scan);
    feed.vnc_request_in_flight = false;
    feed.vnc_frames_received += 1;
    if (feed.vnc_frames_received -% feed.vnc_last_log_frames >= 30) {
        log.print("[render-vm] {d} VNC frames consumed ({d}x{d})\n", .{ feed.vnc_frames_received, feed.width, feed.height });
        feed.vnc_last_log_frames = feed.vnc_frames_received;
    }
    return true;
}

/// Drive the VNC handshake and framebuffer state machine once per frame.
pub fn updateVnc(feed: *Feed) void {
    if (feed.vnc_pump == null) return;
    if (!drainVnc(feed)) return;

    switch (feed.vnc_state) {
        .not_connected, .failed => return,
        .wait_version => {
            if (feed.vnc_rx.items.len < 12) return;
            consumeRx(feed, 12);
            if (!vncWrite(feed, "RFB 003.008\n")) return;
            feed.vnc_state = .wait_security_types;
        },
        .wait_security_types => {
            const bytes = feed.vnc_rx.items;
            if (bytes.len < 1) return;
            const num_types: usize = bytes[0];
            if (num_types == 0) {
                failVnc(feed, "server offered no security types");
                return;
            }
            if (bytes.len < 1 + num_types) return;
            if (std.mem.indexOfScalar(u8, bytes[1 .. 1 + num_types], 1) == null) {
                failVnc(feed, "server does not offer None authentication");
                return;
            }
            consumeRx(feed, 1 + num_types);
            if (!vncWrite(feed, &.{1})) return;
            feed.vnc_state = .wait_security_result;
        },
        .wait_security_result => {
            const bytes = feed.vnc_rx.items;
            if (bytes.len < 4) return;
            if (readU32be(bytes[0..4]) != 0) {
                failVnc(feed, "server rejected authentication");
                return;
            }
            consumeRx(feed, 4);
            if (!vncWrite(feed, &.{1})) return; // ClientInit: shared.
            feed.vnc_state = .wait_server_init;
        },
        .wait_server_init => {
            const bytes = feed.vnc_rx.items;
            if (bytes.len < 24) return;
            const name_len: usize = readU32be(bytes[20..24]);
            if (bytes.len < 24 + name_len) return;
            feed.vnc_fb_width = readU16be(bytes[0..2]);
            feed.vnc_fb_height = readU16be(bytes[2..4]);
            consumeRx(feed, 24 + name_len);

            const pixel_fmt = [20]u8{
                0,  0,   0, 0,   32, 24,  0, 1,
                0,  255, 0, 255, 0,  255, 0, 8,
                16, 0,   0, 0,
            };
            if (!vncWrite(feed, &pixel_fmt)) return;
            const encodings = [_]u8{ 2, 0 } ++ u16be(1) ++ u32be(0);
            if (!vncWrite(feed, &encodings)) return;

            const width: u32 = feed.vnc_fb_width;
            const height: u32 = feed.vnc_fb_height;
            if (!resizeFramebuffer(feed, width, height)) {
                failVnc(feed, "invalid framebuffer dimensions");
                return;
            }
            feed.vnc_state = .ready;
            feed.status = .ready;
            log.info(.render, "VNC connected: {d}x{d}", .{ width, height });
        },
        .ready => {
            if (!feed.vnc_request_in_flight) {
                const incremental: u8 = if (feed.vnc_frames_received > 0) 1 else 0;
                const request = [_]u8{ 3, incremental } ++ u16be(0) ++ u16be(0) ++ u16be(feed.vnc_fb_width) ++ u16be(feed.vnc_fb_height);
                if (!vncWrite(feed, &request)) return;
                feed.vnc_request_in_flight = true;
            }
            _ = applyFramebufferUpdate(feed);
        },
    }
}

// ════════════════════════════════════════════════════════════════════════
// QEMU VM management
// ════════════════════════════════════════════════════════════════════════

pub fn findFreeVncPort(io: std.Io) ?u16 {
    var port: u16 = 5910;
    while (port < 5999) : (port += 1) {
        const address = std.Io.net.IpAddress.parse("127.0.0.1", port) catch continue;
        var server = address.listen(io, .{}) catch continue;
        server.deinit(io);
        return port;
    }
    return null;
}

pub fn startVM(io: std.Io, environ: *const std.process.Environ.Map, feed: *Feed, disk_path: []const u8, memory: u32, cpus: u32) bool {
    const vnc_port = findFreeVncPort(io) orelse {
        log.info(.render, "no free VNC port", .{});
        return false;
    };
    const vnc_display = vnc_port - 5900;

    var mem_buf: [16]u8 = undefined;
    const mem_str = std.fmt.bufPrint(&mem_buf, "{d}", .{memory}) catch return false;

    var cpu_buf: [8]u8 = undefined;
    const cpu_str = std.fmt.bufPrint(&cpu_buf, "{d}", .{cpus}) catch return false;

    var vnc_buf: [8]u8 = undefined;
    const vnc_str = std.fmt.bufPrint(&vnc_buf, ":{d}", .{vnc_display}) catch return false;

    const ext = if (std.mem.lastIndexOfScalar(u8, disk_path, '.')) |dot| disk_path[dot + 1 ..] else "";
    const is_iso = std.ascii.eqlIgnoreCase(ext, "iso");

    const has_kvm = blk: {
        std.Io.Dir.cwd().access(io, "/dev/kvm", .{}) catch break :blk false;
        break :blk true;
    };

    var drive_buf: [600]u8 = undefined;

    // Build argv as []const u8 slices
    var argv: [24][]const u8 = undefined;
    var argc: usize = 0;

    argv[argc] = "qemu-system-x86_64";
    argc += 1;
    if (has_kvm) {
        argv[argc] = "-enable-kvm";
        argc += 1;
    }
    argv[argc] = "-m";
    argc += 1;
    argv[argc] = mem_str;
    argc += 1;
    argv[argc] = "-smp";
    argc += 1;
    argv[argc] = cpu_str;
    argc += 1;

    if (is_iso) {
        argv[argc] = "-cdrom";
        argc += 1;
        argv[argc] = disk_path;
        argc += 1;
        argv[argc] = "-boot";
        argc += 1;
        argv[argc] = "d";
        argc += 1;
    } else {
        argv[argc] = "-drive";
        argc += 1;
        const drive_str = std.fmt.bufPrint(&drive_buf, "file={s},format=raw", .{disk_path}) catch return false;
        argv[argc] = drive_str;
        argc += 1;
    }

    argv[argc] = "-vnc";
    argc += 1;
    argv[argc] = vnc_str;
    argc += 1;
    argv[argc] = "-usb";
    argc += 1;
    argv[argc] = "-device";
    argc += 1;
    argv[argc] = "usb-tablet";
    argc += 1;
    argv[argc] = "-display";
    argc += 1;
    argv[argc] = "none";
    argc += 1;

    log.print("[render-vm] QEMU spawning: kvm={} iso={} disk={s} mem={d}MB cpus={d} vnc=:{d}\n", .{ has_kvm, is_iso, disk_path, memory, cpus, vnc_display });
    log.info(.render, "QEMU spawning: argc={d} kvm={} iso={}", .{ argc, has_kvm, is_iso });

    // Inherit stderr so qemu's own error messages (missing /dev/kvm, bad ISO,
    // etc.) reach the user terminal — without this the VM path fails silently.
    const child = std.process.spawn(io, .{
        .argv = argv[0..argc],
        .stdout = .ignore,
        .stderr = .inherit,
        .stdin = .ignore,
        .environ_map = environ,
    }) catch |err| {
        log.print("[render-vm] QEMU spawn FAILED: {}\n", .{err});
        log.info(.render, "QEMU spawn failed: {}", .{err});
        return false;
    };

    const pixels = page_alloc.alloc(u8, @as(usize, 1024) * @as(usize, 768) * 4) catch {
        // Never Child.kill (SIGTERM + uncancelable wait) on the frame thread
        // — even this just-spawned qemu gets the detached teardown (req_3503).
        child_teardown.terminateDetached(io, environ, child);
        return false;
    };
    feed.qemu_child = child;
    feed.vnc_port = vnc_port;
    feed.width = 1024;
    feed.height = 768;
    feed.pixel_buf = pixels;
    feed.backend = .vnc;
    feed.status = .starting;
    feed.interactive = true;
    feed.startup_wait = 120; // ~2s for QEMU to start

    log.print("[render-vm] QEMU spawned OK, VNC port {d}, waiting {d} frames\n", .{ vnc_port, feed.startup_wait });
    log.info(.render, "QEMU started (VNC :{d}, {d}MB, {d} CPUs)", .{ vnc_display, memory, cpus });
    return true;
}

/// Called during update() to connect VNC after QEMU has started.
pub fn finalizeVM(io: std.Io, feed: *Feed) void {
    if (feed.startup_wait > 0) {
        if (feed.startup_wait % 30 == 0) log.info(.render, "finalizeVM: waiting {d} frames for QEMU", .{feed.startup_wait});
        feed.startup_wait -= 1;
        return;
    }

    log.print("[render-vm] VNC dial 127.0.0.1:{d}\n", .{feed.vnc_port});
    log.info(.render, "finalizeVM: VNC connect to 127.0.0.1:{d}", .{feed.vnc_port});

    // Try to connect to VNC
    const pump = connectVnc(io, "127.0.0.1", feed.vnc_port) orelse {
        log.print("[render-vm] VNC dial failed (retry in 30 frames)\n", .{});
        log.info(.render, "finalizeVM: VNC connect failed, retrying in 30 frames", .{});
        feed.startup_wait = 30;
        return;
    };

    log.info(.render, "finalizeVM: VNC transport connected", .{});
    feed.vnc_pump = pump;
    feed.vnc_state = .wait_version;
    feed.status = .connecting;
    log.info(.render, "VNC connecting to port {d}", .{feed.vnc_port});
}

// ════════════════════════════════════════════════════════════════════════
// Input forwarding — focus, keyboard, mouse
// ════════════════════════════════════════════════════════════════════════

// Focused feed index (null = no render surface focused)
var focused_feed: ?usize = null;
var vnc_button_mask: u8 = 0;

// Per-feed rects (set during paintSurface)
// node_rect = full node computed rect (for hit testing — click anywhere in the node)
// draw_rect = contain-fit quad (for coordinate mapping to VNC framebuffer)
pub const FeedRect = struct { x: f32, y: f32, w: f32, h: f32 };
pub const FeedRects = struct { node: FeedRect = .{ .x = 0, .y = 0, .w = 0, .h = 0 }, draw: FeedRect = .{ .x = 0, .y = 0, .w = 0, .h = 0 }, fb_w: u32 = 0, fb_h: u32 = 0 };
pub var feed_draw_rects: [parent.MAX_FEEDS]FeedRects = [_]FeedRects{.{}} ** parent.MAX_FEEDS;

/// Find which feed (if any) the screen point (mx, my) lands on.
/// Uses the full node rect (not the contain-fit draw rect) for hit testing.
/// Skips suspended feeds — their underlying X server / qemu can't process
/// input, and trying to send events would block the engine on socket flush.
fn hitTestFeeds(mx: f32, my: f32) ?usize {
    const feed_count = parent.feed_count;
    const feeds = &parent.feeds;
    for (0..feed_count) |i| {
        const r = feed_draw_rects[i].node; // hit test against full node rect
        if (r.w > 0 and r.h > 0 and feeds[i].interactive and feeds[i].status == .ready and !feeds[i].suspended) {
            if (mx >= r.x and mx <= r.x + r.w and my >= r.y and my <= r.y + r.h) {
                return i;
            }
        }
    }
    return null;
}

/// Map screen coordinates to VNC framebuffer coordinates.
/// Uses the contain-fit draw rect for coordinate mapping.
fn screenToFb(idx: usize, mx: f32, my: f32) struct { x: u16, y: u16 } {
    const rects = feed_draw_rects[idx];
    const r = rects.draw; // map within the drawn quad
    if (r.w <= 0 or r.h <= 0) return .{ .x = 0, .y = 0 };
    const nx = std.math.clamp((mx - r.x) / r.w, 0, 1);
    const ny = std.math.clamp((my - r.y) / r.h, 0, 1);
    const fx: u16 = @trunc(@min(@as(f32, @floatFromInt(rects.fb_w)) - 1, nx * @as(f32, @floatFromInt(rects.fb_w))));
    const fy: u16 = @trunc(@min(@as(f32, @floatFromInt(rects.fb_h)) - 1, ny * @as(f32, @floatFromInt(rects.fb_h))));
    return .{ .x = fx, .y = fy };
}

fn runInputCommand(io: std.Io, environ: *const std.process.Environ.Map, argv: []const []const u8) void {
    var child = std.process.spawn(io, .{
        .argv = argv,
        .stdout = .ignore,
        .stderr = .ignore,
        .stdin = .ignore,
        .environ_map = environ,
    }) catch return;
    defer child.kill(io);
    _ = child.wait(io) catch return;
}

/// Send a key event to the feed (dispatches by backend).
fn sendKey(io: std.Io, environ: *const std.process.Environ.Map, feed: *Feed, down: bool, keysym: u32) void {
    // Defense-in-depth: hitTestFeeds already skips suspended feeds, but if
    // a stale focused_feed survives a suspend toggle, this guards against
    // XFlush blocking on a SIGSTOP'd Xvfb's full socket buffer.
    if (feed.suspended) return;
    switch (feed.backend) {
        .vnc => {
            if (feed.vnc_pump == null) return;
            if (feed.vnc_state != .ready) return;
            const msg = [_]u8{ 4, if (down) 1 else 0, 0, 0 } ++ u32be(keysym);
            _ = vncWrite(feed, &msg);
        },
        .display_xshm => {
            // XTest: inject key event directly through the X connection — zero latency.
            // Falls back to xdotool subprocess if XTest is unavailable.
            const dpy = feed.display_dpy orelse return;
            const x11 = parent.getX11();
            const xtst = parent.getXtst();
            if (parent.xtest_available) {
                const keycode = x11.XKeysymToKeycode(dpy, @intCast(keysym));
                if (keycode != 0) {
                    _ = xtst.XTestFakeKeyEvent(dpy, @intCast(keycode), if (down) 1 else 0, 0);
                    _ = x11.XFlush(dpy);
                }
            } else {
                // Fallback: xdotool subprocess (slow but always works)
                const display_num = feed.display_num orelse return;
                const xkey = keysymToXdotoolName(keysym) orelse return;
                const action: []const u8 = if (down) "keydown" else "keyup";
                var cmd_buf: [128]u8 = undefined;
                const cmd = std.fmt.bufPrint(&cmd_buf, "DISPLAY=:{d} xdotool {s} {s}", .{ display_num, action, xkey }) catch return;
                const argv = [_][]const u8{ "bash", "-c", cmd };
                runInputCommand(io, environ, &argv);
            }
        },
        else => {},
    }
}

/// Send a pointer event to the feed (dispatches by backend).
fn sendPointer(io: std.Io, environ: *const std.process.Environ.Map, feed: *Feed, x_pos: u16, y_pos: u16, button_mask: u8, event_type: enum { down, up, move }, button: u8) void {
    if (feed.suspended) return;
    switch (feed.backend) {
        .vnc => {
            if (feed.vnc_pump == null) return;
            if (feed.vnc_state != .ready) return;
            const msg = [_]u8{ 5, button_mask } ++ u16be(x_pos) ++ u16be(y_pos);
            _ = vncWrite(feed, &msg);
        },
        .display_xshm => {
            // XTest: inject mouse events directly through X connection — zero latency.
            const dpy = feed.display_dpy orelse return;
            const x11 = parent.getX11();
            const xtst = parent.getXtst();
            if (parent.xtest_available) {
                // Move pointer
                _ = xtst.XTestFakeMotionEvent(dpy, -1, @intCast(x_pos), @intCast(y_pos), 0);
                // Button press/release
                switch (event_type) {
                    .down => _ = xtst.XTestFakeButtonEvent(dpy, @intCast(button), 1, 0),
                    .up => _ = xtst.XTestFakeButtonEvent(dpy, @intCast(button), 0, 0),
                    .move => {},
                }
                _ = x11.XFlush(dpy);
            } else {
                // Fallback: xdotool subprocess
                const display_num = feed.display_num orelse return;
                var cmd_buf: [128]u8 = undefined;
                const cmd = switch (event_type) {
                    .down => std.fmt.bufPrint(&cmd_buf, "DISPLAY=:{d} xdotool mousemove {d} {d} mousedown {d}", .{ display_num, x_pos, y_pos, button }) catch return,
                    .up => std.fmt.bufPrint(&cmd_buf, "DISPLAY=:{d} xdotool mousemove {d} {d} mouseup {d}", .{ display_num, x_pos, y_pos, button }) catch return,
                    .move => std.fmt.bufPrint(&cmd_buf, "DISPLAY=:{d} xdotool mousemove {d} {d}", .{ display_num, x_pos, y_pos }) catch return,
                };
                const argv = [_][]const u8{ "bash", "-c", cmd };
                runInputCommand(io, environ, &argv);
            }
        },
        else => {},
    }
}

/// Map X11 keysym to xdotool key name.
fn keysymToXdotoolName(keysym: u32) ?[]const u8 {
    return switch (keysym) {
        0xff0d => "Return",
        0xff1b => "Escape",
        0xff08 => "BackSpace",
        0xff09 => "Tab",
        0x0020 => "space",
        0xffff => "Delete",
        0xff52 => "Up",
        0xff54 => "Down",
        0xff51 => "Left",
        0xff53 => "Right",
        0xff50 => "Home",
        0xff57 => "End",
        0xff55 => "Prior",
        0xff56 => "Next",
        0xff63 => "Insert",
        0xffe1 => "Shift_L",
        0xffe2 => "Shift_R",
        0xffe3 => "Control_L",
        0xffe4 => "Control_R",
        0xffe9 => "Alt_L",
        0xffea => "Alt_R",
        0xffeb => "Super_L",
        0xffec => "Super_R",
        0xffe5 => "Caps_Lock",
        0xff7f => "Num_Lock",
        0xff14 => "Scroll_Lock",
        0xffbe => "F1",
        0xffbf => "F2",
        0xffc0 => "F3",
        0xffc1 => "F4",
        0xffc2 => "F5",
        0xffc3 => "F6",
        0xffc4 => "F7",
        0xffc5 => "F8",
        0xffc6 => "F9",
        0xffc7 => "F10",
        0xffc8 => "F11",
        0xffc9 => "F12",
        else => {
            // ASCII printable: xdotool accepts single chars
            if (keysym >= 0x20 and keysym <= 0x7e) {
                // Return a static string for common ASCII
                const ascii_table = "                                 !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
                const idx = keysym - 0x20;
                if (idx < ascii_table.len) return ascii_table[idx .. idx + 1];
            }
            return null;
        },
    };
}

// SDL scancode → X11 keysym mapping (matches love2d/lua/render_source.lua KEYSYM table)
fn sdlKeyToKeysym(sym: c_int) ?u32 {
    return switch (sym) {
        c.SDLK_RETURN => 0xff0d,
        c.SDLK_ESCAPE => 0xff1b,
        c.SDLK_BACKSPACE => 0xff08,
        c.SDLK_TAB => 0xff09,
        c.SDLK_SPACE => 0x0020,
        c.SDLK_DELETE => 0xffff,
        c.SDLK_UP => 0xff52,
        c.SDLK_DOWN => 0xff54,
        c.SDLK_LEFT => 0xff51,
        c.SDLK_RIGHT => 0xff53,
        c.SDLK_HOME => 0xff50,
        c.SDLK_END => 0xff57,
        c.SDLK_PAGEUP => 0xff55,
        c.SDLK_PAGEDOWN => 0xff56,
        c.SDLK_INSERT => 0xff63,
        c.SDLK_LSHIFT => 0xffe1,
        c.SDLK_RSHIFT => 0xffe2,
        c.SDLK_LCTRL => 0xffe3,
        c.SDLK_RCTRL => 0xffe4,
        c.SDLK_LALT => 0xffe9,
        c.SDLK_RALT => 0xffea,
        c.SDLK_LGUI => 0xffeb,
        c.SDLK_RGUI => 0xffec,
        c.SDLK_CAPSLOCK => 0xffe5,
        c.SDLK_NUMLOCKCLEAR => 0xff7f,
        c.SDLK_SCROLLLOCK => 0xff14,
        c.SDLK_F1 => 0xffbe,
        c.SDLK_F2 => 0xffbf,
        c.SDLK_F3 => 0xffc0,
        c.SDLK_F4 => 0xffc1,
        c.SDLK_F5 => 0xffc2,
        c.SDLK_F6 => 0xffc3,
        c.SDLK_F7 => 0xffc4,
        c.SDLK_F8 => 0xffc5,
        c.SDLK_F9 => 0xffc6,
        c.SDLK_F10 => 0xffc7,
        c.SDLK_F11 => 0xffc8,
        c.SDLK_F12 => 0xffc9,
        c.SDLK_MINUS => 0x002d,
        c.SDLK_EQUALS => 0x003d,
        c.SDLK_LEFTBRACKET => 0x005b,
        c.SDLK_RIGHTBRACKET => 0x005d,
        c.SDLK_BACKSLASH => 0x005c,
        c.SDLK_SEMICOLON => 0x003b,
        c.SDLK_APOSTROPHE => 0x0027,
        c.SDLK_GRAVE => 0x0060,
        c.SDLK_COMMA => 0x002c,
        c.SDLK_PERIOD => 0x002e,
        c.SDLK_SLASH => 0x002f,
        else => {
            // ASCII printable range: SDL keysym == Unicode codepoint for a-z, 0-9
            if (sym >= 0x20 and sym <= 0x7e) return @intCast(sym);
            return null;
        },
    };
}

/// Handle mouse button down. Returns true if consumed by a render surface.
pub fn handleMouseDown(io: std.Io, environ: *const std.process.Environ.Map, mx: f32, my: f32, button: u8) bool {
    const feed_count = parent.feed_count;
    _ = feed_count;
    if (hitTestFeeds(mx, my)) |idx| {
        focused_feed = idx;
        const pos = screenToFb(idx, mx, my);
        const bit_val: u8 = switch (button) {
            1 => 1,
            2 => 4,
            3 => 2,
            else => 0,
        };
        vnc_button_mask |= bit_val;
        log.print("[render-vm] mouse-down HIT feed={d} backend={s} screen=({d:.0},{d:.0}) fb=({d},{d}) btn={d}\n", .{ idx, @tagName(parent.feeds[idx].backend), mx, my, pos.x, pos.y, button });
        sendPointer(io, environ, &parent.feeds[idx], pos.x, pos.y, vnc_button_mask, .down, button);
        return true;
    }
    log.print("[render-vm] mouse-down MISS at ({d:.0},{d:.0}) — clearing focus\n", .{ mx, my });
    focused_feed = null;
    return false;
}

/// Handle mouse button up. Returns true if consumed.
pub fn handleMouseUp(io: std.Io, environ: *const std.process.Environ.Map, mx: f32, my: f32, button: u8) bool {
    const idx = focused_feed orelse return false;
    if (idx >= parent.feed_count) return false;
    if (parent.feeds[idx].suspended) return false;
    const pos = screenToFb(idx, mx, my);
    const bit_val: u8 = switch (button) {
        1 => 1,
        2 => 4,
        3 => 2,
        else => 0,
    };
    vnc_button_mask &= ~bit_val;
    sendPointer(io, environ, &parent.feeds[idx], pos.x, pos.y, vnc_button_mask, .up, button);
    return true;
}

/// Handle mouse motion. Returns true if consumed.
pub fn handleMouseMotion(io: std.Io, environ: *const std.process.Environ.Map, mx: f32, my: f32) bool {
    const idx = focused_feed orelse return false;
    if (idx >= parent.feed_count) return false;
    if (!parent.feeds[idx].interactive or parent.feeds[idx].status != .ready) return false;
    if (parent.feeds[idx].suspended) return false;
    const pos = screenToFb(idx, mx, my);
    sendPointer(io, environ, &parent.feeds[idx], pos.x, pos.y, vnc_button_mask, .move, 0);
    return true;
}

/// Handle SDL key down. Returns true if consumed by a focused render surface.
pub fn handleKeyDown(io: std.Io, environ: *const std.process.Environ.Map, sym: c_int) bool {
    const idx = focused_feed orelse {
        log.print("[render-vm] keydown sym={d} dropped — no focused feed\n", .{sym});
        return false;
    };
    if (idx >= parent.feed_count) return false;
    if (parent.feeds[idx].suspended) {
        // Don't claim consumption — let the cart's React tree handle this
        // keystroke instead of dropping it into a frozen pane.
        return false;
    }
    const keysym = sdlKeyToKeysym(sym) orelse {
        log.print("[render-vm] keydown sym={d} dropped — no keysym mapping\n", .{sym});
        return false;
    };
    log.print("[render-vm] keydown sym={d} → keysym=0x{x} → backend={s} feed={d}\n", .{ sym, keysym, @tagName(parent.feeds[idx].backend), idx });
    sendKey(io, environ, &parent.feeds[idx], true, keysym);
    return true;
}

/// Handle SDL key up. Returns true if consumed.
pub fn handleKeyUp(io: std.Io, environ: *const std.process.Environ.Map, sym: c_int) bool {
    const idx = focused_feed orelse return false;
    if (idx >= parent.feed_count) return false;
    if (parent.feeds[idx].suspended) return false;
    const keysym = sdlKeyToKeysym(sym) orelse return false;
    sendKey(io, environ, &parent.feeds[idx], false, keysym);
    return true;
}

/// Handle SDL text input. Just consume it — handleKeyDown already sends key events.
/// Without this, printable keys get sent twice (once via KEYDOWN, once via TEXTINPUT).
pub fn handleTextInput(text: [*:0]const u8) bool {
    _ = text;
    const idx = focused_feed orelse return false;
    if (idx >= parent.feed_count) return false;
    if (parent.feeds[idx].suspended) return false;
    return true;
}

/// Check if a render surface currently has focus (for engine to skip other input handling).
pub fn hasFocus() bool {
    return focused_feed != null;
}
