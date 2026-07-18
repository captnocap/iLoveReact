//! Screenshot + video recording — port of love2d/lua/screenshot.lua + recorder.lua
//!
//! Screenshot: triggered by ZIGOS_SCREENSHOT=1. Waits N frames for layout to settle,
//! captures via gpu.captureScreenshot(), encodes PNG in memory, writes via std.Io, exits.
//! Supports node crop (ZIGOS_SCREENSHOT_NODE) and region crop (ZIGOS_SCREENSHOT_REGION).
//!
//! Recording: F9 toggles. Opens ffmpeg pipe, each frame captures via gpu.startCapture(),
//! writes raw BGRA pixels to ffmpeg stdin. ffmpeg encodes in parallel (H.264/VP9).
//! No temp files, no per-frame PNG encoding — same architecture as recorder.lua.
//!
//! Both use gpu.captureScreenshot() / gpu.startCapture() which hook into the END
//! of gpu.frame() after all rendering, before buffer swap — equivalent to Love2D's
//! love.graphics.captureScreenshot(callback).

const std = @import("std");
const log = @import("../diag/log.zig");
const wgpu = @import("wgpu");
const gpu = @import("gpu.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;

// stb only encodes to memory here. File creation and writes stay on the
// injected std.Io capability instead of being hidden inside stbi_write_png.
const StbiWriteFunc = *const fn (context: ?*anyopaque, data: ?*anyopaque, size: c_int) callconv(.c) void;
extern fn stbi_write_png_to_func(func: StbiWriteFunc, context: ?*anyopaque, w: c_int, h: c_int, comp: c_int, data: ?*const anyopaque, stride: c_int) c_int;

const page_alloc = std.heap.page_allocator;

const PngSink = struct {
    bytes: std.ArrayList(u8) = .empty,
    failed: bool = false,
};

fn appendPngBytes(context: ?*anyopaque, data: ?*anyopaque, size: c_int) callconv(.c) void {
    const sink: *PngSink = @ptrCast(@alignCast(context orelse return));
    if (sink.failed or data == null or size <= 0) return;
    const src: [*]const u8 = @ptrCast(data.?);
    sink.bytes.appendSlice(page_alloc, src[0..@intCast(size)]) catch {
        sink.failed = true;
    };
}

fn writePng(io: std.Io, path: []const u8, rgba: []const u8, w: u32, h: u32) bool {
    var sink = PngSink{};
    defer sink.bytes.deinit(page_alloc);
    const encoded = stbi_write_png_to_func(
        appendPngBytes,
        &sink,
        @intCast(w),
        @intCast(h),
        4,
        rgba.ptr,
        @intCast(w * 4),
    );
    if (encoded == 0 or sink.failed) return false;

    const file = if (std.fs.path.isAbsolute(path))
        std.Io.Dir.createFileAbsolute(io, path, .{ .truncate = true }) catch return false
    else
        std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true }) catch return false;
    defer file.close(io);
    file.writeStreamingAll(io, sink.bytes.items) catch return false;
    return true;
}

// ════════════════════════════════════════════════════════════════════════
// Screenshot state (mirrors screenshot.lua)
// ════════════════════════════════════════════════════════════════════════

var ss_enabled: bool = false;
var ss_captured: bool = false;
var ss_frame: u32 = 0;
/// Frames to wait before the env-mode capture (layout settle). Default 60;
/// ZIGOS_SCREENSHOT_FRAMES overrides (SELFSHOT-0606: the CLI flow's knob).
var ss_wait_frames: u32 = 60;

var ss_path_buf: [512]u8 = undefined;
var ss_path: []const u8 = "screenshot.png";

var ss_node_buf: [256]u8 = undefined;
var ss_node: ?[]const u8 = null;

var ss_region: ?struct { x: u32, y: u32, w: u32, h: u32 } = null;
var ss_padding: u32 = 8;

// Stash for root pointer (needed in capture callback)
var ss_root: ?*Node = null;
var ss_should_exit: bool = false;

// ════════════════════════════════════════════════════════════════════════
// Recorder state (mirrors recorder.lua)
// ════════════════════════════════════════════════════════════════════════

var rec_active: bool = false;
var rec_frame_count: u32 = 0;
var rec_child: ?std.process.Child = null;
var rec_width: u32 = 0;
var rec_height: u32 = 0;

// ════════════════════════════════════════════════════════════════════════
// Init — check env vars for screenshot mode (like screenshot.lua.init())
// ════════════════════════════════════════════════════════════════════════

pub fn init(environ: *const std.process.Environ.Map) void {
    const ss = environ.get("ZIGOS_SCREENSHOT") orelse return;
    if (!std.mem.eql(u8, ss, "1")) return;

    ss_enabled = true;

    if (environ.get("ZIGOS_SCREENSHOT_OUTPUT")) |p| {
        if (p.len <= ss_path_buf.len) {
            @memcpy(ss_path_buf[0..p.len], p);
            ss_path = ss_path_buf[0..p.len];
        }
    }

    if (environ.get("ZIGOS_SCREENSHOT_NODE")) |n| {
        if (n.len < ss_node_buf.len) {
            @memcpy(ss_node_buf[0..n.len], n);
            ss_node = ss_node_buf[0..n.len];
        }
    }

    if (environ.get("ZIGOS_SCREENSHOT_REGION")) |r| {
        var parts: [4]u32 = .{ 0, 0, 0, 0 };
        var idx: usize = 0;
        var iter = std.mem.splitScalar(u8, r, ',');
        while (iter.next()) |part| {
            if (idx >= 4) break;
            parts[idx] = std.fmt.parseInt(u32, part, 10) catch 0;
            idx += 1;
        }
        if (idx == 4 and parts[2] > 0 and parts[3] > 0) {
            ss_region = .{ .x = parts[0], .y = parts[1], .w = parts[2], .h = parts[3] };
        }
    }

    if (environ.get("ZIGOS_SCREENSHOT_PAD")) |p| {
        ss_padding = std.fmt.parseInt(u32, p, 10) catch 8;
    }

    if (environ.get("ZIGOS_SCREENSHOT_FRAMES")) |f| {
        ss_wait_frames = std.fmt.parseInt(u32, f, 10) catch 60;
        if (ss_wait_frames == 0) ss_wait_frames = 1;
    }

    log.print("[capture] screenshot mode enabled → {s}\n", .{ss_path});
}

pub fn isScreenshotMode() bool {
    return ss_enabled;
}

// ════════════════════════════════════════════════════════════════════════
// Per-frame tick — called from engine after gpu.frame()
// Returns true if the app should exit (screenshot captured).
// ════════════════════════════════════════════════════════════════════════

pub fn tick(root: ?*Node) bool {
    // Screenshot mode: wait N frames then capture
    if (ss_enabled and !ss_captured) {
        ss_frame += 1;
        if (ss_frame >= ss_wait_frames) {
            ss_root = root;
            log.print("[capture] requesting screenshot frame {d}...\n", .{ss_frame});
            gpu.captureScreenshot(&onScreenshotPixels);
            // The callback fires during NEXT gpu.frame() — we return true on that frame
        }
    }

    if (ss_should_exit) return true;
    return false;
}

// ════════════════════════════════════════════════════════════════════════
// Screenshot callback — receives BGRA pixels from gpu.performCapture()
// ════════════════════════════════════════════════════════════════════════

fn onScreenshotPixels(io: std.Io, pixels: [*]const u8, w: u32, h: u32, stride: u32) void {
    ss_captured = true;
    log.print("[capture] received {d}x{d} pixels (stride={d})\n", .{ w, h, stride });

    // Resolve crop region
    var cx: u32 = 0;
    var cy: u32 = 0;
    var cw: u32 = w;
    var ch: u32 = h;

    if (ss_region) |reg| {
        cx = reg.x;
        cy = reg.y;
        cw = reg.w;
        ch = reg.h;
    } else if (ss_node) |target| {
        if (ss_root) |root| {
            if (findNodeByTarget(root, target)) |rect| {
                const pad = ss_padding;
                cx = if (rect.x > pad) rect.x - pad else 0;
                cy = if (rect.y > pad) rect.y - pad else 0;
                cw = @min(rect.w + pad * 2, w - cx);
                ch = @min(rect.h + pad * 2, h - cy);
                log.print("[capture] crop to '{s}' ({d},{d},{d},{d})\n", .{ target, cx, cy, cw, ch });
            } else {
                log.print("[capture] node '{s}' not found, full page\n", .{target});
            }
        }
    }

    // Clamp
    if (cx + cw > w) cw = w - cx;
    if (cy + ch > h) ch = h - cy;
    if (cw == 0 or ch == 0) return;

    writeRegionPng(io, ss_path, pixels, stride, cx, cy, cw, ch);
    ss_should_exit = true;
}

/// BGRA frame region → RGBA PNG on disk. Shared by the env-mode screenshot
/// (above) and the live __capture_frame one-shot (below) — one write path.
fn writeRegionPng(io: std.Io, path: []const u8, pixels: [*]const u8, stride: u32, cx: u32, cy: u32, cw: u32, ch: u32) void {
    const out_size = @as(usize, cw) * @as(usize, ch) * 4;
    const rgba = page_alloc.alloc(u8, out_size) catch return;
    defer page_alloc.free(rgba);

    for (0..ch) |row| {
        const src_off = @as(usize, cy + @as(u32, @intCast(row))) * @as(usize, stride) + @as(usize, cx) * 4;
        const dst_off = row * @as(usize, cw) * 4;
        for (0..cw) |col| {
            const si = src_off + col * 4;
            const di = dst_off + col * 4;
            rgba[di + 0] = pixels[si + 2]; // R ← B
            rgba[di + 1] = pixels[si + 1]; // G ← G
            rgba[di + 2] = pixels[si + 0]; // B ← R
            rgba[di + 3] = pixels[si + 3]; // A ← A
        }
    }

    if (writePng(io, path, rgba, cw, ch)) {
        log.print("SCREENSHOT_SAVED:{s} ({d}x{d})\n", .{ path, cw, ch });
    } else {
        log.print("[capture] PNG encode/write failed: {s}\n", .{path});
    }
}

/// Write already-RGBA pixels straight to a PNG (no framebuffer, no BGRA swizzle).
/// The model-package writer uses this to persist a painted atlas as a real,
/// copy-anywhere image file (req_2523). `rgba` must be w*h*4 bytes.
pub fn writeRgbaPng(io: std.Io, path: []const u8, rgba: []const u8, w: u32, h: u32) bool {
    if (rgba.len < @as(usize, w) * @as(usize, h) * 4) return false;
    return writePng(io, path, rgba, w, h);
}

// ════════════════════════════════════════════════════════════════════════
// Live one-shot — __capture_frame(path) (SELFSHOT-0606)
//
// The app screenshots ITSELF: a host-fn-driven capture of the next rendered
// frame on a RUNNING app, written to `path` as a full-frame PNG. Unlike the
// env-mode screenshot above it never exits, and unlike the F9 recorder it
// disarms itself after one delivery. Desktop/X11 capture of the user's
// system is BANNED (the 2026-06-06 all-lanes stop) — this is the
// replacement: the swapchain readback the GPU already composed.
// ════════════════════════════════════════════════════════════════════════

var live_path_buf: [512]u8 = undefined;
var live_path: ?[]const u8 = null;

/// Queue a one-shot capture of the next rendered frame to a PNG at `path`.
/// Returns false when the path is unusable or the F9 recorder owns the
/// capture hook (one callback slot in gpu.zig — don't steal a recording).
pub fn requestFrame(path: []const u8) bool {
    if (rec_active) {
        log.print("[capture] __capture_frame refused — F9 recording owns the capture hook\n", .{});
        return false;
    }
    if (path.len == 0 or path.len > live_path_buf.len) return false;
    @memcpy(live_path_buf[0..path.len], path);
    live_path = live_path_buf[0..path.len];
    gpu.captureScreenshot(&onLiveFramePixels);
    return true;
}

fn onLiveFramePixels(io: std.Io, pixels: [*]const u8, w: u32, h: u32, stride: u32) void {
    // One-shot: disarm FIRST — captureScreenshot leaves the hook armed
    // (env mode exits after one frame and never needed to clear it).
    gpu.stopCapture();
    const path = live_path orelse return;
    live_path = null;
    if (w == 0 or h == 0) return;
    writeRegionPng(io, path, pixels, stride, 0, 0, w, h);
}

// ════════════════════════════════════════════════════════════════════════
// Recording — F9 toggle (mirrors recorder.lua start/stop)
// ════════════════════════════════════════════════════════════════════════

/// Handle F9 key. Returns true if consumed.
pub fn handleKey(io: std.Io, environ: *const std.process.Environ.Map, sym: c_int) bool {
    const c_imports = @import("../c.zig").imports;
    if (sym == c_imports.SDLK_F9) {
        if (rec_active) stopRecording(io) else startRecording(io, environ);
        return true;
    }
    return false;
}

fn startRecording(io: std.Io, environ: *const std.process.Environ.Map) void {
    const w = gpu.getWidth();
    const h = gpu.getHeight();
    if (w == 0 or h == 0) return;

    rec_width = w;
    rec_height = h;

    // Spawn ffmpeg directly. Its stdin pipe is an std.Io.File owned by the
    // Child; no shell, libc FILE stream, or ambient process environment.
    var size_buf: [32]u8 = undefined;
    const size = std.fmt.bufPrint(&size_buf, "{d}x{d}", .{ w, h }) catch return;
    const argv = [_][]const u8{
        "ffmpeg",   "-y",   "-loglevel", "error",   "-f",            "rawvideo",
        "-pix_fmt", "bgra", "-s",        size,      "-r",            "30",
        "-i",       "-",    "-c:v",      "libx264", "-preset",       "ultrafast",
        "-crf",     "18",   "-pix_fmt",  "yuv420p", "recording.mp4",
    };
    rec_child = std.process.spawn(io, .{
        .argv = &argv,
        .stdin = .pipe,
        .stdout = .ignore,
        .stderr = .ignore,
        .environ_map = environ,
    }) catch null;
    if (rec_child == null) {
        log.print("[capture] failed to open ffmpeg pipe — is ffmpeg installed?\n", .{});
        return;
    }

    rec_active = true;
    rec_frame_count = 0;
    gpu.startCapture(&onRecordPixels);
    log.print("[capture] recording started {d}x{d} → recording.mp4\n", .{ w, h });
}

fn stopRecording(io: std.Io) void {
    gpu.stopCapture();
    rec_active = false;

    if (rec_child) |*child| {
        // EOF is ffmpeg's flush/finalize signal. wait() would deadlock if the
        // parent's write end remained open until child cleanup.
        if (child.stdin) |file| {
            file.close(io);
            child.stdin = null;
        }
        _ = child.wait(io) catch {};
        rec_child = null;
    }

    log.print("[capture] recording stopped. {d} frames → recording.mp4\n", .{rec_frame_count});
}

fn onRecordPixels(io: std.Io, pixels: [*]const u8, w: u32, h: u32, stride: u32) void {
    const child = if (rec_child) |*value| value else return;
    const pipe = child.stdin orelse return;
    if (w != rec_width or h != rec_height) return;

    // Write raw BGRA pixels to ffmpeg — row by row if stride != w*4
    const row_bytes = @as(usize, w) * 4;
    if (stride == @as(u32, @intCast(row_bytes))) {
        // No padding — write entire buffer at once
        pipe.writeStreamingAll(io, pixels[0 .. @as(usize, w) * @as(usize, h) * 4]) catch {
            stopRecording(io);
            return;
        };
    } else {
        // Strip row padding
        for (0..h) |row| {
            const off = row * @as(usize, stride);
            pipe.writeStreamingAll(io, (pixels + off)[0..row_bytes]) catch {
                stopRecording(io);
                return;
            };
        }
    }

    rec_frame_count += 1;
}

// ════════════════════════════════════════════════════════════════════════
// Node search — find by testId or debugName (like screenshot.lua findNode)
// ════════════════════════════════════════════════════════════════════════

const Rect = struct { x: u32, y: u32, w: u32, h: u32 };

fn findNodeByTarget(node: *Node, target: []const u8) ?Rect {
    if (node.test_id) |tid| {
        if (std.mem.eql(u8, tid, target)) return nodeRect(node);
    }
    if (node.debug_name) |dn| {
        if (std.mem.eql(u8, dn, target)) return nodeRect(node);
    }
    for (node.children) |*child| {
        if (findNodeByTarget(child, target)) |rect| return rect;
    }
    return null;
}

fn nodeRect(node: *Node) Rect {
    const r = node.computed;
    return .{
        .x = @intFromFloat(@max(0, r.x)),
        .y = @intFromFloat(@max(0, r.y)),
        .w = @intFromFloat(@max(1, r.w)),
        .h = @intFromFloat(@max(1, r.h)),
    };
}

// ════════════════════════════════════════════════════════════════════════
// Cleanup
// ════════════════════════════════════════════════════════════════════════

pub fn deinit(io: std.Io) void {
    if (rec_active) stopRecording(io);
}
