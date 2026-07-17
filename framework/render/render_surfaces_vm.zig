//! Render surfaces — VM/VNC protocol and input forwarding.
//!
//! Split from render_surfaces.zig. Contains:
//!   - VNC RFB client (handshake, framebuffer updates)
//!   - QEMU VM management (spawn, VNC connect)
//!   - Input forwarding (mouse, keyboard → VNC/XTest/xdotool)

const std = @import("std");
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const posix = @import("../net/sysx.zig");
const log = @import("../diag/log.zig");
const c = @import("../c.zig").imports;

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

/// Non-blocking read from VNC socket. Returns bytes read or 0.
pub fn vncRead(sock: posix.socket_t, buf: []u8) usize {
    const n = posix.read(sock, buf) catch |err| {
        if (err != error.WouldBlock) {
            log.info(.render, "vnc: read error: {s}", .{@errorName(err)});
        }
        return 0;
    };
    return n;
}

/// Read exactly buf.len bytes, polling between reads with `timeout_ms`
/// per chunk. Returns true on success, false on timeout or socket error.
/// Use timeout_ms=0 for a single non-blocking poll (don't wait at all).
///
/// This exists because the VNC protocol parser is stateless across update()
/// calls — once we start consuming a response we MUST read it whole, or the
/// next call will read from the middle of a message and desync forever.
pub fn recvExactBlocking(sock: posix.socket_t, buf: []u8, timeout_ms: i32) bool {
    var got: usize = 0;
    while (got < buf.len) {
        var pfd = [_]posix.pollfd{.{ .fd = sock, .events = posix.POLL.IN, .revents = 0 }};
        const ready = posix.poll(&pfd, timeout_ms) catch return false;
        if (ready == 0) return false;
        if ((pfd[0].revents & posix.POLL.IN) == 0) return false;
        const n = posix.read(sock, buf[got..]) catch |err| {
            if (err == error.WouldBlock) continue;
            log.info(.render, "vnc: recvExact error: {s}", .{@errorName(err)});
            return false;
        };
        if (n == 0) return false;
        got += n;
    }
    return true;
}

/// Blocking-ish write to VNC socket.
pub fn vncWrite(sock: posix.socket_t, data: []const u8) bool {
    var sent: usize = 0;
    while (sent < data.len) {
        const n = posix.write(sock, data[sent..]) catch return false;
        if (n == 0) return false;
        sent += n;
    }
    return true;
}

pub fn connectVnc(host_str: []const u8, port: u16) ?posix.socket_t {
    const addr = std.net.Address.parseIp4(host_str, port) catch return null;

    const sock = posix.socket(posix.AF.INET, posix.SOCK.STREAM, 0) catch return null;
    errdefer posix.close(sock);

    posix.connect(sock, &addr.any, addr.getOsSockLen()) catch {
        posix.close(sock);
        return null;
    };

    parent.setNonBlocking(sock);
    return sock;
}

/// Drive the VNC handshake state machine. Called each frame.
pub fn updateVnc(feed: *Feed) void {
    const sock = feed.vnc_socket orelse {
        log.info(.render, "vnc: updateVnc: no socket", .{});
        return;
    };

    switch (feed.vnc_state) {
        .not_connected, .failed => return,

        .wait_version => {
            // Read 12-byte RFB version string
            var ver_buf: [12]u8 = undefined;
            const n = vncRead(sock, &ver_buf);
            if (n < 12) {
                if (n > 0) log.info(.render, "vnc: wait_version: got {d}/12 bytes", .{n});
                return;
            }

            log.print("[render-vm] VNC handshake: server version received, sending RFB 003.008\n", .{});
            log.info(.render, "vnc: got server version, sending ours", .{});
            _ = vncWrite(sock, "RFB 003.008\n");
            feed.vnc_state = .wait_security_types;
        },

        .wait_security_types => {
            // Read security type count (1 byte) + types
            var sec_buf: [64]u8 = undefined;
            const n = vncRead(sock, &sec_buf);
            if (n == 0) return;

            const num_types = sec_buf[0];
            if (num_types == 0) {
                log.print("[render-vm] VNC handshake FAILED: server reports 0 security types\n", .{});
                feed.vnc_state = .failed;
                feed.status = .@"error";
                return;
            }
            if (n < 1 + @as(usize, num_types)) return; // wait for full type list

            // Select SecurityType 1 (None) — QEMU localhost uses no auth
            log.print("[render-vm] VNC handshake: selecting None auth ({d} types offered)\n", .{num_types});
            _ = vncWrite(sock, &[_]u8{1});
            feed.vnc_state = .wait_security_result;
        },

        .wait_security_result => {
            // 4 bytes: 0 = OK
            var res_buf: [4]u8 = undefined;
            const n = vncRead(sock, &res_buf);
            if (n < 4) return;

            if (readU32be(&res_buf) != 0) {
                log.print("[render-vm] VNC handshake FAILED: server rejected auth\n", .{});
                feed.vnc_state = .failed;
                feed.status = .@"error";
                return;
            }

            // ClientInit: shared = true
            log.print("[render-vm] VNC handshake: auth OK, sending ClientInit\n", .{});
            _ = vncWrite(sock, &[_]u8{1});
            feed.vnc_state = .wait_server_init;
        },

        .wait_server_init => {
            // ServerInit: width(2) + height(2) + pixelFormat(16) + nameLen(4) = 24 bytes min
            var init_buf: [256]u8 = undefined;
            const n = vncRead(sock, &init_buf);
            if (n < 24) return;

            feed.vnc_fb_width = readU16be(init_buf[0..2]);
            feed.vnc_fb_height = readU16be(init_buf[2..4]);

            const name_len = readU32be(init_buf[20..24]);
            // Consume name bytes (may already be in buffer, or skip)
            _ = name_len;

            // SetPixelFormat: 32bpp RGBA little-endian
            const pixel_fmt = [20]u8{
                0, 0, 0, 0, // type=0, padding x3
                32, // bits-per-pixel
                24, // depth
                0, // big-endian = false
                1, // true-colour = true
                0, 255, // red-max = 255
                0, 255, // green-max = 255
                0, 255, // blue-max = 255
                0, // red-shift = 0
                8, // green-shift = 8
                16, // blue-shift = 16
                0, 0, 0, // padding
            };
            _ = vncWrite(sock, &pixel_fmt);

            // SetEncodings: RAW(0)
            const encodings = [_]u8{ 2, 0 } ++ u16be(1) ++ u32be(0);
            _ = vncWrite(sock, &encodings);

            // Resize feed to match VNC framebuffer
            const vw: u32 = @intCast(feed.vnc_fb_width);
            const vh: u32 = @intCast(feed.vnc_fb_height);
            if (vw > 0 and vh > 0 and (vw != feed.width or vh != feed.height)) {
                // Reallocate pixel buffer
                if (feed.pixel_buf) |old| page_alloc.free(old);
                feed.pixel_buf = page_alloc.alloc(u8, @as(usize, vw) * @as(usize, vh) * 4) catch {
                    feed.status = .@"error";
                    return;
                };
                feed.width = vw;
                feed.height = vh;
                // Invalidate wgpu texture (will be recreated). release() rather
                // than destroy() so wgpu refcount keeps any in-flight queued
                // draw call alive until the queue submit completes.
                if (feed.bind_group) |bg| bg.release();
                if (feed.sampler) |s| s.release();
                if (feed.texture_view) |tv| tv.release();
                if (feed.texture) |t| t.release();
                feed.bind_group = null;
                feed.sampler = null;
                feed.texture_view = null;
                feed.texture = null;
            }

            feed.vnc_state = .ready;
            feed.status = .ready;
            log.print("[render-vm] VNC ready: framebuffer {d}x{d}\n", .{ vw, vh });
            log.info(.render, "VNC connected: {d}x{d}", .{ vw, vh });
        },

        .ready => {
            // Throttle: only one framebuffer-update request in flight at a
            // time. Without this we'd issue 60 full-screen RGBA requests/sec
            // (72MB/s for 640x480), saturate qemu's TCP send buffer in
            // ~30 seconds, and qemu would stop generating frames entirely.
            // After the first non-incremental request, switch to incremental
            // updates so qemu only re-sends regions that actually changed.
            if (!feed.vnc_request_in_flight) {
                const incremental: u8 = if (feed.vnc_frames_received > 0) 1 else 0;
                const req = [_]u8{ 3, incremental } ++ u16be(0) ++ u16be(0) ++ u16be(feed.vnc_fb_width) ++ u16be(feed.vnc_fb_height);
                _ = vncWrite(sock, &req);
                feed.vnc_request_in_flight = true;
            }

            // Read FramebufferUpdate response. recvExactBlocking blocks
            // briefly (up to 50ms per chunk) so partial-read desync can't
            // happen — once we start parsing a response we consume it whole.
            var msg_buf: [4]u8 = undefined;
            if (!recvExactBlocking(sock, &msg_buf, 0)) return; // nothing yet, retry next frame

            if (msg_buf[0] == 0) {
                // FramebufferUpdate: type(1) + padding(1) + numRects(2)
                const num_rects = readU16be(msg_buf[2..4]);
                if (!feed.diag_first_frame_logged) {
                    log.print("[render-vm] FramebufferUpdate received: {d} rects\n", .{num_rects});
                }

                var rect_i: u16 = 0;
                while (rect_i < num_rects) : (rect_i += 1) {
                    // Rectangle header: x(2)+y(2)+w(2)+h(2)+encoding(4) = 12 bytes
                    var rect_hdr: [12]u8 = undefined;
                    if (!recvExactBlocking(sock, &rect_hdr, 200)) {
                        log.print("[render-vm] rect_hdr read timed out — connection stalled\n", .{});
                        feed.vnc_request_in_flight = false;
                        return;
                    }

                    const rw = readU16be(rect_hdr[4..6]);
                    const rh = readU16be(rect_hdr[6..8]);
                    const encoding = readU32be(rect_hdr[8..12]);

                    if (encoding == 0) {
                        // RAW encoding — read pixel data directly into feed buffer
                        const pix_size: usize = @as(usize, rw) * @as(usize, rh) * 4;
                        const rx: usize = @intCast(readU16be(rect_hdr[0..2]));
                        const ry: usize = @intCast(readU16be(rect_hdr[2..4]));

                        const buf = feed.pixel_buf orelse break;
                        const fb_w: usize = @intCast(feed.width);

                        // If full-screen rect, read directly into pixel_buf
                        if (rx == 0 and ry == 0 and rw == feed.vnc_fb_width and rh == feed.vnc_fb_height) {
                            if (!recvExactBlocking(sock, buf[0..pix_size], 500)) {
                                log.print("[render-vm] full-frame pixel read timed out ({d} bytes)\n", .{pix_size});
                                feed.vnc_request_in_flight = false;
                                return;
                            }
                            feed.dirty = true;
                            if (!feed.diag_first_frame_logged) {
                                log.print("[render-vm] first VNC frame received: full {d}x{d} ({d} bytes)\n", .{ rw, rh, pix_size });
                                feed.diag_first_frame_logged = true;
                            }
                        } else {
                            // Partial rect — read row by row into correct position
                            const rect_w: usize = @intCast(rw);
                            const rect_h: usize = @intCast(rh);
                            var row_buf: [8192]u8 = undefined; // max ~2048px wide
                            const row_bytes = rect_w * 4;

                            var row: usize = 0;
                            while (row < rect_h) : (row += 1) {
                                if (row_bytes > row_buf.len) break;
                                if (!recvExactBlocking(sock, row_buf[0..row_bytes], 200)) {
                                    log.print("[render-vm] partial-rect row read timed out\n", .{});
                                    feed.vnc_request_in_flight = false;
                                    return;
                                }
                                // Copy into framebuffer at (rx, ry+row)
                                const dst_off = ((ry + row) * fb_w + rx) * 4;
                                if (dst_off + row_bytes <= buf.len) {
                                    @memcpy(buf[dst_off .. dst_off + row_bytes], row_buf[0..row_bytes]);
                                }
                            }
                            feed.dirty = true;
                        }
                    } else if (encoding == 0xFFFFFF21) {
                        // DesktopSize pseudo-encoding (-223): the rect's w,h
                        // is the new framebuffer size. No pixel data follows.
                        // Resize the pixel buffer + invalidate the wgpu texture
                        // so ensureTexture recreates it at the new dimensions.
                        const new_w: u32 = @intCast(rw);
                        const new_h: u32 = @intCast(rh);
                        log.print("[render-vm] DesktopSize: framebuffer resize {d}x{d} → {d}x{d}\n", .{ feed.vnc_fb_width, feed.vnc_fb_height, new_w, new_h });
                        if (new_w > 0 and new_h > 0 and (new_w != feed.width or new_h != feed.height)) {
                            if (feed.pixel_buf) |old| page_alloc.free(old);
                            feed.pixel_buf = page_alloc.alloc(u8, @as(usize, new_w) * @as(usize, new_h) * 4) catch {
                                feed.status = .@"error";
                                return;
                            };
                            feed.width = new_w;
                            feed.height = new_h;
                            feed.vnc_fb_width = @intCast(new_w);
                            feed.vnc_fb_height = @intCast(new_h);
                            // release() — see deinit comment about destroy() vs in-flight queues
                            if (feed.bind_group) |bg| bg.release();
                            if (feed.sampler) |s| s.release();
                            if (feed.texture_view) |tv| tv.release();
                            if (feed.texture) |t| t.release();
                            feed.bind_group = null;
                            feed.sampler = null;
                            feed.texture_view = null;
                            feed.texture = null;
                        }
                    } else {
                        // We only advertised RAW(0) in SetEncodings, so anything
                        // else is a server bug or a pseudo-encoding we don't
                        // know the data shape of (Cursor, etc.). Don't try to
                        // guess byte counts — that's what causes "garbage frame"
                        // corruption when we drain N bytes of real pixel data.
                        // Tear the connection down cleanly so the cart can
                        // reconnect.
                        log.print("[render-vm] unsupported encoding 0x{x} for {d}x{d} rect — closing VNC\n", .{ encoding, rw, rh });
                        feed.status = .@"error";
                        feed.vnc_request_in_flight = false;
                        return;
                    }
                }

                // Full FramebufferUpdate consumed — clear in-flight so the
                // next .ready tick can issue the next request.
                feed.vnc_request_in_flight = false;
                feed.vnc_frames_received += 1;

                // Periodic heartbeat so we can confirm the loop is healthy.
                if (feed.vnc_frames_received -% feed.vnc_last_log_frames >= 30) {
                    log.print("[render-vm] {d} VNC frames consumed ({d}x{d})\n", .{ feed.vnc_frames_received, feed.width, feed.height });
                    feed.vnc_last_log_frames = feed.vnc_frames_received;
                }
            }
        },
    }
}

// ════════════════════════════════════════════════════════════════════════
// QEMU VM management
// ════════════════════════════════════════════════════════════════════════

pub fn findFreeVncPort() ?u16 {
    var port: u16 = 5910;
    while (port < 5999) : (port += 1) {
        // Try to bind — if it works, port is free
        const sock = posix.socket(posix.AF.INET, posix.SOCK.STREAM, 0) catch continue;
        defer posix.close(sock);
        const addr = std.net.Address.parseIp4("127.0.0.1", port) catch continue;
        posix.connect(sock, &addr.any, addr.getOsSockLen()) catch {
            return port; // connect failed = port is free
        };
    }
    return null;
}

pub fn startVM(feed: *Feed, disk_path: []const u8, memory: u32, cpus: u32) bool {
    const vnc_port = findFreeVncPort() orelse {
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
        _ = std.fs.cwd().statFile("/dev/kvm") catch break :blk false;
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

    var child = std.process.Child.init(argv[0..argc], page_alloc);
    child.stdout_behavior = .Ignore;
    // Inherit stderr so qemu's own error messages (missing /dev/kvm, bad ISO,
    // etc.) reach the user terminal — without this the VM path fails silently.
    child.stderr_behavior = .Inherit;
    child.stdin_behavior = .Ignore;

    log.print("[render-vm] QEMU spawning: kvm={} iso={} disk={s} mem={d}MB cpus={d} vnc=:{d}\n", .{ has_kvm, is_iso, disk_path, memory, cpus, vnc_display });
    log.info(.render, "QEMU spawning: argc={d} kvm={} iso={}", .{ argc, has_kvm, is_iso });

    child.spawn() catch |err| {
        log.print("[render-vm] QEMU spawn FAILED: {}\n", .{err});
        log.info(.render, "QEMU spawn failed: {}", .{err});
        return false;
    };

    feed.qemu_child = child;
    feed.vnc_port = vnc_port;
    feed.width = 1024;
    feed.height = 768;
    feed.pixel_buf = page_alloc.alloc(u8, @as(usize, 1024) * @as(usize, 768) * 4) catch return false;
    feed.backend = .vnc;
    feed.status = .starting;
    feed.interactive = true;
    feed.startup_wait = 120; // ~2s for QEMU to start

    log.print("[render-vm] QEMU spawned OK, VNC port {d}, waiting {d} frames\n", .{ vnc_port, feed.startup_wait });
    log.info(.render, "QEMU started (VNC :{d}, {d}MB, {d} CPUs)", .{ vnc_display, memory, cpus });
    return true;
}

/// Called during update() to connect VNC after QEMU has started.
pub fn finalizeVM(feed: *Feed) void {
    if (feed.startup_wait > 0) {
        if (feed.startup_wait % 30 == 0) log.info(.render, "finalizeVM: waiting {d} frames for QEMU", .{feed.startup_wait});
        feed.startup_wait -= 1;
        return;
    }

    log.print("[render-vm] VNC dial 127.0.0.1:{d}\n", .{feed.vnc_port});
    log.info(.render, "finalizeVM: VNC connect to 127.0.0.1:{d}", .{feed.vnc_port});

    // Try to connect to VNC
    const sock = connectVnc("127.0.0.1", feed.vnc_port) orelse {
        log.print("[render-vm] VNC dial failed (retry in 30 frames)\n", .{});
        log.info(.render, "finalizeVM: VNC connect failed, retrying in 30 frames", .{});
        feed.startup_wait = 30;
        return;
    };

    log.print("[render-vm] VNC connected sock={d}\n", .{sock});
    log.info(.render, "finalizeVM: VNC connected, sock={d}", .{sock});
    feed.vnc_socket = sock;
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
    const fx: u16 = @intFromFloat(@min(@as(f32, @floatFromInt(rects.fb_w)) - 1, nx * @as(f32, @floatFromInt(rects.fb_w))));
    const fy: u16 = @intFromFloat(@min(@as(f32, @floatFromInt(rects.fb_h)) - 1, ny * @as(f32, @floatFromInt(rects.fb_h))));
    return .{ .x = fx, .y = fy };
}

/// Send a key event to the feed (dispatches by backend).
fn sendKey(feed: *Feed, down: bool, keysym: u32) void {
    // Defense-in-depth: hitTestFeeds already skips suspended feeds, but if
    // a stale focused_feed survives a suspend toggle, this guards against
    // XFlush blocking on a SIGSTOP'd Xvfb's full socket buffer.
    if (feed.suspended) return;
    switch (feed.backend) {
        .vnc => {
            const sock = feed.vnc_socket orelse return;
            if (feed.vnc_state != .ready) return;
            const msg = [_]u8{ 4, if (down) 1 else 0, 0, 0 } ++ u32be(keysym);
            _ = vncWrite(sock, &msg);
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
                var child = std.process.Child.init(&argv, page_alloc);
                child.stdout_behavior = .Ignore;
                child.stderr_behavior = .Ignore;
                child.stdin_behavior = .Ignore;
                child.spawn() catch return;
            }
        },
        else => {},
    }
}

/// Send a pointer event to the feed (dispatches by backend).
fn sendPointer(feed: *Feed, x_pos: u16, y_pos: u16, button_mask: u8, event_type: enum { down, up, move }, button: u8) void {
    if (feed.suspended) return;
    switch (feed.backend) {
        .vnc => {
            const sock = feed.vnc_socket orelse return;
            if (feed.vnc_state != .ready) return;
            const msg = [_]u8{ 5, button_mask } ++ u16be(x_pos) ++ u16be(y_pos);
            _ = vncWrite(sock, &msg);
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
                var child = std.process.Child.init(&argv, page_alloc);
                child.stdout_behavior = .Ignore;
                child.stderr_behavior = .Ignore;
                child.stdin_behavior = .Ignore;
                child.spawn() catch return;
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
pub fn handleMouseDown(mx: f32, my: f32, button: u8) bool {
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
        sendPointer(&parent.feeds[idx], pos.x, pos.y, vnc_button_mask, .down, button);
        return true;
    }
    log.print("[render-vm] mouse-down MISS at ({d:.0},{d:.0}) — clearing focus\n", .{ mx, my });
    focused_feed = null;
    return false;
}

/// Handle mouse button up. Returns true if consumed.
pub fn handleMouseUp(mx: f32, my: f32, button: u8) bool {
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
    sendPointer(&parent.feeds[idx], pos.x, pos.y, vnc_button_mask, .up, button);
    return true;
}

/// Handle mouse motion. Returns true if consumed.
pub fn handleMouseMotion(mx: f32, my: f32) bool {
    const idx = focused_feed orelse return false;
    if (idx >= parent.feed_count) return false;
    if (!parent.feeds[idx].interactive or parent.feeds[idx].status != .ready) return false;
    if (parent.feeds[idx].suspended) return false;
    const pos = screenToFb(idx, mx, my);
    sendPointer(&parent.feeds[idx], pos.x, pos.y, vnc_button_mask, .move, 0);
    return true;
}

/// Handle SDL key down. Returns true if consumed by a focused render surface.
pub fn handleKeyDown(sym: c_int) bool {
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
    sendKey(&parent.feeds[idx], true, keysym);
    return true;
}

/// Handle SDL key up. Returns true if consumed.
pub fn handleKeyUp(sym: c_int) bool {
    const idx = focused_feed orelse return false;
    if (idx >= parent.feed_count) return false;
    if (parent.feeds[idx].suspended) return false;
    const keysym = sdlKeyToKeysym(sym) orelse return false;
    sendKey(&parent.feeds[idx], false, keysym);
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
