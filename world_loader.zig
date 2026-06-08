//! world_loader.zig — the stateless Zig loader (PLATMOD §4, V28). NO V8.
//!
//! Built with -Duse-v8=false: the binary links the GPU substrate (SDL3 + wgpu +
//! the framework draw pipelines + capture) and ZERO V8 / zero embedded bundle.
//! It reads a baked game-file, hands it to the constructor (which installs +
//! verifies the asset vocabulary and resolves every reference), and renders the
//! composed map tiles to the swapchain — then captures its OWN frame to a PNG
//! (SELFSHOT-0606, hidden window, no desktop). This proves the user's pipeline
//! end to end at small scale: data -> stateless engine -> rendered frame, no JS.
//!
//! Build:
//!   zig build app -Dapp-name=world_loader -Dapp-source=world_loader.zig \
//!     -Duse-v8=false -Dhas-gpu=true -Doptimize=ReleaseFast
//! Run (headless self-capture):
//!   ZIGOS_HEADLESS=1 ZIGOS_SCREENSHOT=1 ZIGOS_SCREENSHOT_OUTPUT=out.png \
//!     ZIGOS_SCREENSHOT_FRAMES=8 ./zig-out/bin/world_loader [game-file.b64]

const std = @import("std");
const c = @import("framework/c.zig").imports;
const gpu = @import("framework/gpu/gpu.zig");
const rects = @import("framework/gpu/rects.zig");
const capture = @import("framework/gpu/capture.zig");
const scene3d = @import("framework/gpu/3d.zig");
const layout = @import("framework/layout.zig");
const Node = layout.Node;
const constructor = @import("framework/world/constructor.zig");

const WIN_W: c_int = 800;
const WIN_H: c_int = 600;
const DEFAULT_FIXTURE = "framework/testing/fixtures/gamefile_roundtrip.b64";
const STORE_DIR = "zig-out/game/contentstore";
const MAX_FRAMES: u32 = 600;

const log = std.debug;

/// Read a game-file. The on-disk fixture is base64 text (the bake writer's
/// __fs_write is string-only); decode it to the raw RJMP bytes.
fn loadGameFile(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    const raw = try std.fs.cwd().readFileAlloc(allocator, path, 8 << 20);
    defer allocator.free(raw);
    const trimmed = std.mem.trim(u8, raw, " \t\r\n");
    const dec = std.base64.standard.Decoder;
    const size = try dec.calcSizeForSlice(trimmed);
    const out = try allocator.alloc(u8, size);
    errdefer allocator.free(out);
    try dec.decode(out, trimmed);
    return out;
}

/// Map a tile value to a fill color. Empty cells are not drawn (show the bg):
/// a null cell, and — by hmsc's string-table convention — tile index 0, which
/// is the 'null' kind. Indices 1.. are distinct map kinds, colored by palette.
fn tileColor(value: ?u16) ?[3]f32 {
    const v = value orelse return null;
    if (v == 0) return null;
    const palette = [_][3]f32{
        .{ 0.18, 0.65, 0.62 }, // teal
        .{ 0.92, 0.52, 0.18 }, // orange
        .{ 0.30, 0.45, 0.85 }, // blue
        .{ 0.45, 0.72, 0.34 }, // green
        .{ 0.82, 0.35, 0.55 }, // magenta
        .{ 0.85, 0.78, 0.30 }, // yellow
        .{ 0.55, 0.55, 0.62 }, // gray
        .{ 0.70, 0.45, 0.30 }, // brown
    };
    return palette[@as(usize, v - 1) % palette.len];
}

/// Lay the constructed tile grid out as colored rects, centered in the window.
fn drawScene(scene: constructor.Scene) void {
    rects.reset();
    if (scene.width == 0 or scene.height == 0) return;

    const cols: f32 = @floatFromInt(scene.width);
    const rows: f32 = @floatFromInt(scene.height);
    const margin: f32 = 60.0;
    const avail_w: f32 = @as(f32, @floatFromInt(WIN_W)) - margin * 2;
    const avail_h: f32 = @as(f32, @floatFromInt(WIN_H)) - margin * 2;
    const cell = @min(avail_w / cols, avail_h / rows);
    const grid_w = cell * cols;
    const grid_h = cell * rows;
    const ox = (@as(f32, @floatFromInt(WIN_W)) - grid_w) / 2.0;
    const oy = (@as(f32, @floatFromInt(WIN_H)) - grid_h) / 2.0;
    const gap: f32 = 6.0;

    var y: u32 = 0;
    while (y < scene.height) : (y += 1) {
        var x: u32 = 0;
        while (x < scene.width) : (x += 1) {
            const color = tileColor(scene.tiles[y * scene.width + x]) orelse continue;
            const px = ox + @as(f32, @floatFromInt(x)) * cell + gap;
            const py = oy + @as(f32, @floatFromInt(y)) * cell + gap;
            rects.drawRect(px, py, cell - gap * 2, cell - gap * 2, color[0], color[1], color[2], 1.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        }
    }
}

// ── Stage-1 3D probe: drive gpu/3d.zig from the no-V8 loader ────────────────
// A unit cube as 36 interleaved verts (pos3 + normal3 + uv2), CCW-wound for the
// back-face/ccw mesh pipeline. This is the smallest proof that the stateless 3D
// render capability already in the host runs from data with no V8 — the same
// path the world's baked <Scene3D.Mesh> instances will ride.
fn buildCube() [36 * 8]f32 {
    const Corner = [3]f32;
    const Face = struct { n: Corner, a: Corner, b: Corner, c: Corner, d: Corner };
    const v0 = Corner{ -0.5, -0.5, -0.5 };
    const v1 = Corner{ 0.5, -0.5, -0.5 };
    const v2 = Corner{ 0.5, 0.5, -0.5 };
    const v3 = Corner{ -0.5, 0.5, -0.5 };
    const v4 = Corner{ -0.5, -0.5, 0.5 };
    const v5 = Corner{ 0.5, -0.5, 0.5 };
    const v6 = Corner{ 0.5, 0.5, 0.5 };
    const v7 = Corner{ -0.5, 0.5, 0.5 };
    const faces = [_]Face{
        .{ .n = .{ 0, 0, 1 }, .a = v4, .b = v5, .c = v6, .d = v7 }, // +Z
        .{ .n = .{ 0, 0, -1 }, .a = v1, .b = v0, .c = v3, .d = v2 }, // -Z
        .{ .n = .{ 1, 0, 0 }, .a = v5, .b = v1, .c = v2, .d = v6 }, // +X
        .{ .n = .{ -1, 0, 0 }, .a = v0, .b = v4, .c = v7, .d = v3 }, // -X
        .{ .n = .{ 0, 1, 0 }, .a = v7, .b = v6, .c = v2, .d = v3 }, // +Y
        .{ .n = .{ 0, -1, 0 }, .a = v0, .b = v1, .c = v5, .d = v4 }, // -Y
    };
    const uvs = [4][2]f32{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    for (faces) |f| {
        const quad = [4]Corner{ f.a, f.b, f.c, f.d };
        for ([6]usize{ 0, 1, 2, 0, 2, 3 }) |q| {
            const p = quad[q];
            out[i + 0] = p[0];
            out[i + 1] = p[1];
            out[i + 2] = p[2];
            out[i + 3] = f.n[0];
            out[i + 4] = f.n[1];
            out[i + 5] = f.n[2];
            out[i + 6] = uvs[q][0];
            out[i + 7] = uvs[q][1];
            i += 8;
        }
    }
    return out;
}

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    var path: []const u8 = DEFAULT_FIXTURE;
    var threed = false;
    for (args[1..]) |a| {
        if (std.mem.eql(u8, a, "--3d")) {
            threed = true;
        } else if (!std.mem.startsWith(u8, a, "--")) {
            path = a;
        }
    }

    // ── construct from data (NO V8) ──────────────────────────────────────
    const bytes = loadGameFile(allocator, path) catch |err| {
        log.print("[loader] failed to read game-file {s}: {any}\n", .{ path, err });
        return err;
    };
    defer allocator.free(bytes);

    var store = std.fs.cwd().makeOpenPath(STORE_DIR, .{}) catch |err| {
        log.print("[loader] cannot open content store {s}: {any}\n", .{ STORE_DIR, err });
        return err;
    };
    defer store.close();

    const scene = constructor.construct(allocator, bytes, store) catch |err| {
        log.print("[loader] construct FAILED: {any}\n", .{err});
        return err;
    };
    defer scene.deinit(allocator);
    log.print("[loader] constructed map {d}x{d} from {s} (no JS)\n", .{ scene.width, scene.height, path });

    // ── render the composed scene (stateless GPU substrate) ──────────────
    if (!c.SDL_Init(c.SDL_INIT_VIDEO)) {
        log.print("[loader] SDL_Init failed\n", .{});
        return error.SDLInitFailed;
    }
    defer c.SDL_Quit();

    const headless = std.posix.getenv("ZIGOS_HEADLESS") != null;
    const flags: u64 = if (headless) c.SDL_WINDOW_HIDDEN else 0;
    const window = c.SDL_CreateWindow("world_loader", WIN_W, WIN_H, flags) orelse {
        log.print("[loader] SDL_CreateWindow failed\n", .{});
        return error.WindowFailed;
    };

    gpu.init(window) catch |err| {
        log.print("[loader] gpu.init failed: {any}\n", .{err});
        return err;
    };
    capture.init();

    // Two run modes:
    //   - screenshot (headless): render a few frames, capture the PNG, exit.
    //     This is what `rjit game shot` / `rjit game verify` drive.
    //   - visible (no ZIGOS_HEADLESS, no screenshot env): a real window you can
    //     look at and close — pumps events, runs until QUIT / window-close / ESC.
    const screenshotting = capture.isScreenshotMode();
    if (!screenshotting) log.print("[loader] live window — close it or press ESC to exit\n", .{});

    // ── Stage-1 3D scene (gated on --3d): a Scene3D node tree the loader hands
    // to gpu/3d.zig. The world's baked meshes will populate this same shape. ──
    var cube = buildCube();
    var kids = [_]Node{
        .{ .scene3d_camera = true, .scene3d_pos_x = 3.5, .scene3d_pos_y = 3.0, .scene3d_pos_z = 5.0, .scene3d_look_x = 0, .scene3d_look_y = 0.15, .scene3d_look_z = 0, .scene3d_fov = 45 },
        .{ .scene3d_light = true, .scene3d_light_type = "ambient", .scene3d_color_r = 0.45, .scene3d_color_g = 0.47, .scene3d_color_b = 0.55, .scene3d_intensity = 1.0 },
        .{ .scene3d_light = true, .scene3d_light_type = "directional", .scene3d_dir_x = -0.5, .scene3d_dir_y = -1.0, .scene3d_dir_z = -0.4, .scene3d_color_r = 1.0, .scene3d_color_g = 0.95, .scene3d_color_b = 0.88, .scene3d_intensity = 1.3 },
        .{ .scene3d_mesh = true, .scene3d_geom_key = "cube", .scene3d_vertices = cube[0..], .scene3d_vert_count = 36, .scene3d_color_r = 0.92, .scene3d_color_g = 0.52, .scene3d_color_b = 0.18, .scene3d_color_a = 1.0 },
    };
    var root = Node{ .children = kids[0..] };
    if (threed) log.print("[loader] 3D probe — rendering a cube via gpu/3d.zig (no JS)\n", .{});

    var running = true;
    var frame: u32 = 0;
    while (running) : (frame += 1) {
        // Pump window events so the window stays responsive and closeable.
        var event: c.SDL_Event = undefined;
        while (c.SDL_PollEvent(&event)) {
            switch (event.type) {
                c.SDL_EVENT_QUIT, c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => running = false,
                c.SDL_EVENT_KEY_DOWN => {
                    if (event.key.key == c.SDLK_ESCAPE) running = false;
                },
                else => {},
            }
        }

        if (threed) {
            _ = scene3d.render(&root, 0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H), 1.0);
        } else {
            drawScene(scene);
        }
        gpu.frame(0.06, 0.07, 0.10);

        if (screenshotting) {
            if (capture.tick(null) or frame >= MAX_FRAMES) break; // captured → exit
        } else {
            c.SDL_Delay(16); // ~60fps cap so a static scene doesn't spin the CPU
        }
    }
    log.print("[loader] done after {d} frames\n", .{frame});
}
