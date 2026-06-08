//! world_loader.zig — the stateless Zig loader (PLATMOD §4, V28). NO V8.
//!
//! Built with -Duse-v8=false: the binary links the GPU substrate (SDL3 + wgpu +
//! the framework draw pipelines + capture) and ZERO V8 / zero embedded bundle.
//! It reads a baked game-file, hands it to the constructor (which installs +
//! verifies the asset vocabulary and resolves every reference), and renders the
//! constructed world's 3D geometry to the swapchain via gpu/3d.zig — then (in
//! headless mode) captures its OWN frame to a PNG (SELFSHOT-0606, hidden window,
//! no desktop). This proves the user's pipeline end to end: TypeScript/React ->
//! encoded data -> stateless engine -> rendered 3D frame, no JS.
//!
//! The world's geometry rides as a packed instance buffer (the INSTANCES map
//! lump): every authored object — region, road, prop, building, landform — is
//! one box instance. The host expands the whole batch with a single interned
//! unit-cube geometry and one instanced draw. 3D is the ONLY path — there is no
//! 2D tile grid and no flag to gate it.
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
// Instance row: pos3 + rot3 + scale3 + color3 (matches gpu/3d.zig stride>=12).
const INSTANCE_STRIDE: usize = 12;

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

/// Map a tile value to a fill color. Empty cells are not drawn: a null cell, and
/// — by hmsc's string-table convention — tile index 0, the 'null' kind. Indices
/// 1.. are distinct map kinds. Used only for the tile-extrusion fallback when a
/// game-file carries no instance buffer (e.g. the codec round-trip fixture).
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

/// A unit cube as 36 interleaved verts (pos3 + normal3 + uv2), CCW-wound for the
/// back-face/ccw mesh pipeline. ONE interned geometry; every world object is an
/// instance of it, scaled + positioned + colored by the instance buffer.
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

/// Fallback geometry for a game-file with no instance buffer: extrude each
/// non-null tile into one box instance (stride 9: pos3/scale3/color3). Heap-
/// owned; the caller frees it after the frame loop.
fn extrudeTiles(allocator: std.mem.Allocator, scene: constructor.Scene) ![]f32 {
    var list: std.ArrayList(f32) = .{};
    errdefer list.deinit(allocator);
    var y: u32 = 0;
    while (y < scene.height) : (y += 1) {
        var x: u32 = 0;
        while (x < scene.width) : (x += 1) {
            const color = tileColor(scene.tiles[y * scene.width + x]) orelse continue;
            try list.appendSlice(allocator, &[_]f32{
                @floatFromInt(x), 0.25, @floatFromInt(y), // position (center)
                0,                0,    0, // rotation (yaw unused)
                0.9,              0.5,  0.9, // scale
                color[0],         color[1], color[2], // color
            });
        }
    }
    return list.toOwnedSlice(allocator);
}

const Bounds = struct {
    cx: f32,
    cy: f32,
    cz: f32,
    radius: f32, // half the largest world extent (xz), min-clamped
};

/// Axis-aligned bounds of an instance batch (each row: pos3/scale3/color3),
/// used to auto-frame the camera so the whole world fits in view.
fn instanceBounds(insts: []const f32, count: u32, stride: usize) Bounds {
    if (count == 0) return .{ .cx = 0, .cy = 0, .cz = 0, .radius = 16 };
    // Scale floats follow the optional rot3 block: at +6 for stride>=12, else +3.
    const scale_base: usize = if (stride >= 12) 6 else 3;
    var min_x: f32 = std.math.floatMax(f32);
    var min_y: f32 = std.math.floatMax(f32);
    var min_z: f32 = std.math.floatMax(f32);
    var max_x: f32 = -std.math.floatMax(f32);
    var max_y: f32 = -std.math.floatMax(f32);
    var max_z: f32 = -std.math.floatMax(f32);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const b = i * stride;
        const px = insts[b + 0];
        const py = insts[b + 1];
        const pz = insts[b + 2];
        const hx = @abs(insts[b + scale_base + 0]) * 0.5;
        const hy = @abs(insts[b + scale_base + 1]) * 0.5;
        const hz = @abs(insts[b + scale_base + 2]) * 0.5;
        min_x = @min(min_x, px - hx);
        max_x = @max(max_x, px + hx);
        min_y = @min(min_y, py - hy);
        max_y = @max(max_y, py + hy);
        min_z = @min(min_z, pz - hz);
        max_z = @max(max_z, pz + hz);
    }
    const span_x = max_x - min_x;
    const span_z = max_z - min_z;
    const radius = @max(8.0, @max(span_x, span_z) * 0.5);
    return .{
        .cx = (min_x + max_x) * 0.5,
        .cy = (min_y + max_y) * 0.5,
        .cz = (min_z + max_z) * 0.5,
        .radius = radius,
    };
}

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    var path: []const u8 = DEFAULT_FIXTURE;
    for (args[1..]) |a| {
        if (!std.mem.startsWith(u8, a, "--")) path = a;
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

    // ── resolve the 3D instance batch: the baked geometry, else extrude tiles ─
    var fallback: ?[]f32 = null;
    defer if (fallback) |f| allocator.free(f);
    var insts: []const f32 = scene.instances;
    var inst_count: u32 = scene.instance_count;
    var stride: usize = if (scene.instance_stride > 0) scene.instance_stride else INSTANCE_STRIDE;
    if (inst_count == 0) {
        const f = extrudeTiles(allocator, scene) catch |err| {
            log.print("[loader] tile extrusion FAILED: {any}\n", .{err});
            return err;
        };
        fallback = f;
        insts = f;
        stride = INSTANCE_STRIDE;
        inst_count = @intCast(f.len / INSTANCE_STRIDE);
        log.print("[loader] no instance buffer — extruded {d} tile boxes\n", .{inst_count});
    }
    // The first `piece_count` rows are the placed structures (the /test city);
    // the camera frames on THEM so the towers fill the view instead of being a
    // speck on the 240m ground plane. 0 → frame on everything (tile fallback).
    const piece_count: u32 = scene.piece_count;
    // The render proof greps this exact line: real geometry, real positions.
    log.print("[loader] built {d} mesh instances ({d} placed pieces)\n", .{ inst_count, piece_count });
    if (inst_count == 0) {
        log.print("[loader] FAIL: no geometry to render\n", .{});
        return error.NoGeometry;
    }

    // ── render the constructed scene (stateless GPU substrate) ───────────
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

    const screenshotting = capture.isScreenshotMode();
    if (!screenshotting) log.print("[loader] live window — close it or press ESC to exit\n", .{});

    // ── build the Scene3D node tree: an iso camera framed to the world, two
    //    lights, and ONE instanced mesh carrying every object's transform. ──
    // Frame on the placed structures (piece rows) when present — the ground
    // plane is the whole 240m map and would shrink the city to a dot.
    const frame_count: u32 = if (piece_count > 0) piece_count else inst_count;
    const bounds = instanceBounds(insts, frame_count, stride);
    const dist = bounds.radius * 1.9 + 12.0;
    var cube = buildCube();
    var kids = [_]Node{
        .{
            .scene3d_camera = true,
            .scene3d_pos_x = bounds.cx + dist * 0.85,
            .scene3d_pos_y = bounds.cy + dist * 0.95,
            .scene3d_pos_z = bounds.cz + dist * 0.85,
            .scene3d_look_x = bounds.cx,
            .scene3d_look_y = bounds.cy,
            .scene3d_look_z = bounds.cz,
            .scene3d_fov = 45,
            .scene3d_far = dist * 4.0 + bounds.radius * 2.0,
        },
        .{ .scene3d_light = true, .scene3d_light_type = "ambient", .scene3d_color_r = 0.55, .scene3d_color_g = 0.57, .scene3d_color_b = 0.62, .scene3d_intensity = 1.0 },
        .{ .scene3d_light = true, .scene3d_light_type = "directional", .scene3d_dir_x = -0.55, .scene3d_dir_y = -1.0, .scene3d_dir_z = -0.35, .scene3d_color_r = 1.0, .scene3d_color_g = 0.96, .scene3d_color_b = 0.9, .scene3d_intensity = 1.25 },
        .{
            .scene3d_mesh = true,
            .scene3d_geom_key = "box",
            .scene3d_vertices = cube[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = insts,
            .scene3d_instance_count = inst_count,
            .scene3d_instance_stride = @intCast(stride),
        },
    };
    var root = Node{ .children = kids[0..] };

    var running = true;
    var frame: u32 = 0;
    while (running) : (frame += 1) {
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

        _ = scene3d.render(&root, 0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H), 1.0);
        gpu.frame(0.52, 0.62, 0.74); // sky-ish clear so the ground reads against it

        if (screenshotting) {
            if (capture.tick(null) or frame >= MAX_FRAMES) break; // captured → exit
        } else {
            c.SDL_Delay(16); // ~60fps cap so a static scene doesn't spin the CPU
        }
    }
    log.print("[loader] done after {d} frames\n", .{frame});
}
