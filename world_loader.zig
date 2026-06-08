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
const AVATAR_PARTS: usize = 6;
const SCAN_A: usize = 4;
const SCAN_D: usize = 7;
const SCAN_S: usize = 22;
const SCAN_W: usize = 26;
const SCAN_LSHIFT: usize = 225;

const log = std.debug;

const Vec3 = struct {
    x: f32,
    y: f32,
    z: f32,
};

const PlayerState = struct {
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
};

const CameraState = struct {
    yaw: f32,
    pitch: f32,
    distance: f32,
    focus_height: f32,
    far: f32,
    fov: f32,
};

fn clamp(v: f32, lo: f32, hi: f32) f32 {
    return @max(lo, @min(hi, v));
}

fn nowNs() i64 {
    return @as(i64, @truncate(std.time.nanoTimestamp()));
}

fn keyDown(scancode: usize) bool {
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) return false;
    return keys[scancode];
}

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
                0, 0, 0, // rotation (yaw unused)
                0.9, 0.5, 0.9, // scale
                color[0], color[1], color[2], // color
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

fn instanceTop(insts: []const f32, row: usize, stride: usize) f32 {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    return insts[b + 1] + @abs(insts[b + scale_base + 1]) * 0.5;
}

fn instanceCovers(insts: []const f32, row: usize, stride: usize, x: f32, z: f32) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const hx = @abs(insts[b + scale_base + 0]) * 0.5;
    const hz = @abs(insts[b + scale_base + 2]) * 0.5;
    return x >= insts[b + 0] - hx and x <= insts[b + 0] + hx and
        z >= insts[b + 2] - hz and z <= insts[b + 2] + hz;
}

fn chooseSpawn(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, bounds: Bounds) Vec3 {
    const wanted_x = bounds.cx;
    const wanted_z = bounds.cz;
    var best_row: ?usize = null;
    var best_dist2: f32 = std.math.floatMax(f32);
    const total_rows: usize = @intCast(inst_count);
    var row: usize = @min(@as(usize, @intCast(piece_count)), total_rows);
    while (row < total_rows) : (row += 1) {
        const b = row * stride;
        const scale_base: usize = if (stride >= 12) 6 else 3;
        const sy = @abs(insts[b + scale_base + 1]);
        if (sy > 0.75) continue;
        const dx = insts[b + 0] - wanted_x;
        const dz = insts[b + 2] - wanted_z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best_dist2) {
            best_dist2 = d2;
            best_row = row;
        }
    }
    if (best_row == null) {
        row = 0;
        while (row < total_rows) : (row += 1) {
            const b = row * stride;
            const scale_base: usize = if (stride >= 12) 6 else 3;
            const sx = @abs(insts[b + scale_base + 0]);
            const sy = @abs(insts[b + scale_base + 1]);
            const sz = @abs(insts[b + scale_base + 2]);
            if (sy > 1.0 or sx < 1.0 or sz < 1.0) continue;
            const dx = insts[b + 0] - wanted_x;
            const dz = insts[b + 2] - wanted_z;
            const d2 = dx * dx + dz * dz;
            if (d2 < best_dist2) {
                best_dist2 = d2;
                best_row = row;
            }
        }
    }
    if (best_row) |r| {
        const b = r * stride;
        return .{ .x = insts[b + 0], .y = instanceTop(insts, r, stride), .z = insts[b + 2] };
    }

    var y = bounds.cy;
    row = 0;
    var found_cover = false;
    while (row < total_rows) : (row += 1) {
        if (!instanceCovers(insts, row, stride, wanted_x, wanted_z)) continue;
        const top = instanceTop(insts, row, stride);
        if (!found_cover or top > y) {
            y = top;
            found_cover = true;
        }
    }
    if (!found_cover) y = 0;
    return .{ .x = wanted_x, .y = y, .z = wanted_z };
}

fn groundHeightAt(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, x: f32, z: f32) ?f32 {
    const total_rows: usize = @intCast(inst_count);
    var row: usize = @min(@as(usize, @intCast(piece_count)), total_rows);
    var best: ?f32 = null;
    while (row < total_rows) : (row += 1) {
        const b = row * stride;
        const scale_base: usize = if (stride >= 12) 6 else 3;
        if (@abs(insts[b + scale_base + 1]) > 0.75) continue;
        if (!instanceCovers(insts, row, stride, x, z)) continue;
        const top = instanceTop(insts, row, stride);
        if (best == null or top > best.?) best = top;
    }
    return best;
}

fn writeInstance(out: []f32, row: usize, x: f32, y: f32, z: f32, yaw_rad: f32, sx: f32, sy: f32, sz: f32, color: [3]f32) void {
    const b = row * INSTANCE_STRIDE;
    out[b + 0] = x;
    out[b + 1] = y;
    out[b + 2] = z;
    out[b + 3] = 0;
    out[b + 4] = yaw_rad * 180.0 / std.math.pi;
    out[b + 5] = 0;
    out[b + 6] = sx;
    out[b + 7] = sy;
    out[b + 8] = sz;
    out[b + 9] = color[0];
    out[b + 10] = color[1];
    out[b + 11] = color[2];
}

fn writeAvatarPart(out: []f32, row: usize, player: PlayerState, lx: f32, ly: f32, lz: f32, sx: f32, sy: f32, sz: f32, color: [3]f32) void {
    const s = @sin(player.yaw);
    const c0 = @cos(player.yaw);
    const x = player.x + lx * c0 + lz * s;
    const z = player.z - lx * s + lz * c0;
    writeInstance(out, row, x, player.y + ly, z, player.yaw, sx, sy, sz, color);
}

fn writeAvatar(out: []f32, player: PlayerState) void {
    writeAvatarPart(out, 0, player, -0.22, 0.45, 0.0, 0.30, 0.90, 0.30, .{ 0.10, 0.18, 0.28 });
    writeAvatarPart(out, 1, player, 0.22, 0.45, 0.0, 0.30, 0.90, 0.30, .{ 0.10, 0.18, 0.28 });
    writeAvatarPart(out, 2, player, 0.0, 1.14, 0.0, 0.72, 0.82, 0.34, .{ 0.16, 0.48, 0.90 });
    writeAvatarPart(out, 3, player, -0.58, 1.15, 0.0, 0.22, 0.74, 0.24, .{ 0.76, 0.58, 0.42 });
    writeAvatarPart(out, 4, player, 0.58, 1.15, 0.0, 0.22, 0.74, 0.24, .{ 0.76, 0.58, 0.42 });
    writeAvatarPart(out, 5, player, 0.0, 1.77, 0.0, 0.46, 0.46, 0.46, .{ 0.86, 0.68, 0.50 });
}

fn updateCameraNode(camera: *Node, cam: CameraState, player: PlayerState) void {
    const target = Vec3{ .x = player.x, .y = player.y + cam.focus_height, .z = player.z };
    const cp = @cos(cam.pitch);
    const sx = @sin(cam.yaw) * cp * cam.distance;
    const sy = @sin(cam.pitch) * cam.distance;
    const sz = @cos(cam.yaw) * cp * cam.distance;
    camera.scene3d_pos_x = target.x + sx;
    camera.scene3d_pos_y = target.y + sy;
    camera.scene3d_pos_z = target.z + sz;
    camera.scene3d_look_x = target.x;
    camera.scene3d_look_y = target.y;
    camera.scene3d_look_z = target.z;
    camera.scene3d_fov = cam.fov;
    camera.scene3d_far = cam.far;
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
    // 0 world instances = a genuinely empty map (no pieces, no paint). Switching
    // to an empty map should still render a skybox and the runtime avatar.
    if (inst_count == 0) log.print("[loader] empty world — rendering avatar over void\n", .{});

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

    // ── build the Scene3D node tree from DATA: the camera/lights/sky come from
    //    the game-file's render environment (scene.env), NOT hardcoded here
    //    (USER req_0308 — the look is data and changes over time). The loader
    //    only adds what is geometric: it FRAMES the camera on the placed
    //    structures' bounds, deriving distance/height from the authored factors.
    //    A steep top-down iso foreshortens 3m-tall, 0.6m-wide pillars into
    //    specks; the authored low angle shows them as solid verticals. ──
    const env = scene.env;
    const frame_count: u32 = if (piece_count > 0) piece_count else inst_count;
    const bounds = instanceBounds(insts, frame_count, stride);
    const horiz = bounds.radius * env.cam_horiz_factor + env.cam_horiz_base;
    const height = bounds.radius * env.cam_height_factor + env.cam_height_base;
    const far = (horiz + height + bounds.radius) * env.cam_far_factor;
    const authored_eye = Vec3{
        .x = bounds.cx + horiz * 0.72,
        .y = bounds.cy + height,
        .z = bounds.cz + horiz * 0.72,
    };
    const authored_dx = authored_eye.x - bounds.cx;
    const authored_dy = authored_eye.y - bounds.cy;
    const authored_dz = authored_eye.z - bounds.cz;
    const authored_xz = @sqrt(authored_dx * authored_dx + authored_dz * authored_dz);
    const authored_dist = @sqrt(authored_xz * authored_xz + authored_dy * authored_dy);
    const spawn = chooseSpawn(insts, inst_count, piece_count, stride, bounds);
    var player = PlayerState{
        .x = spawn.x,
        .y = spawn.y,
        .z = spawn.z,
        .yaw = std.math.atan2(-authored_dx, -authored_dz),
    };
    var camera = CameraState{
        .yaw = std.math.atan2(authored_dx, authored_dz),
        .pitch = clamp(std.math.atan2(authored_dy, @max(0.001, authored_xz)), 0.12, 1.05),
        .distance = clamp(authored_dist, 8.0, @max(36.0, bounds.radius * 1.35)),
        .focus_height = 1.25,
        .far = @max(far, bounds.radius * 4.0 + 64.0),
        .fov = env.cam_fov,
    };
    var avatar_instances: [AVATAR_PARTS * INSTANCE_STRIDE]f32 = undefined;
    writeAvatar(avatar_instances[0..], player);
    var cube = buildCube();
    var kids = [_]Node{
        .{
            .scene3d_camera = true,
            .scene3d_pos_x = 0,
            .scene3d_pos_y = 0,
            .scene3d_pos_z = 0,
            .scene3d_look_x = 0,
            .scene3d_look_y = 0,
            .scene3d_look_z = 0,
            .scene3d_fov = env.cam_fov,
            .scene3d_far = far,
        },
        .{
            .scene3d_skybox = true,
            .scene3d_sky_zenith = env.sky_zenith,
            .scene3d_sky_horizon = env.sky_horizon,
            .scene3d_sky_ground = env.sky_ground,
            .scene3d_sky_sun_dir = env.sky_sun_dir,
            .scene3d_sky_sun_color = env.sky_sun_color,
            .scene3d_sky_haze = env.sky_haze,
            .scene3d_sky_cloud = env.sky_cloud,
            .scene3d_sky_night = env.sky_night,
        },
        .{ .scene3d_light = true, .scene3d_light_type = "ambient", .scene3d_color_r = env.ambient_color[0], .scene3d_color_g = env.ambient_color[1], .scene3d_color_b = env.ambient_color[2], .scene3d_intensity = env.ambient_intensity },
        .{ .scene3d_light = true, .scene3d_light_type = "directional", .scene3d_dir_x = env.dir[0], .scene3d_dir_y = env.dir[1], .scene3d_dir_z = env.dir[2], .scene3d_color_r = env.dir_color[0], .scene3d_color_g = env.dir_color[1], .scene3d_color_b = env.dir_color[2], .scene3d_intensity = env.dir_intensity },
        .{
            .scene3d_mesh = true,
            .scene3d_geom_key = "box",
            .scene3d_vertices = cube[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = avatar_instances[0..],
            .scene3d_instance_count = AVATAR_PARTS,
            .scene3d_instance_stride = INSTANCE_STRIDE,
        },
        .{
            .scene3d_mesh = inst_count > 0, // false on an empty map; avatar still draws
            .scene3d_geom_key = "box",
            .scene3d_vertices = cube[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = insts,
            .scene3d_instance_count = inst_count,
            .scene3d_instance_stride = @intCast(stride),
        },
    };
    var root = Node{ .children = kids[0..] };
    updateCameraNode(&kids[0], camera, player);

    var running = true;
    var orbit_drag = false;
    var last_ns = nowNs();
    var frame: u32 = 0;
    while (running) : (frame += 1) {
        var event: c.SDL_Event = undefined;
        while (c.SDL_PollEvent(&event)) {
            switch (event.type) {
                c.SDL_EVENT_QUIT, c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => running = false,
                c.SDL_EVENT_KEY_DOWN => {
                    if (event.key.key == c.SDLK_ESCAPE) running = false;
                },
                c.SDL_EVENT_MOUSE_BUTTON_DOWN => {
                    if (event.button.button == c.SDL_BUTTON_LEFT or event.button.button == c.SDL_BUTTON_RIGHT) orbit_drag = true;
                },
                c.SDL_EVENT_MOUSE_BUTTON_UP => {
                    if (event.button.button == c.SDL_BUTTON_LEFT or event.button.button == c.SDL_BUTTON_RIGHT) orbit_drag = false;
                },
                c.SDL_EVENT_MOUSE_MOTION => {
                    if (orbit_drag) {
                        camera.yaw -= event.motion.xrel * 0.006;
                        camera.pitch = clamp(camera.pitch - event.motion.yrel * 0.004, 0.10, 1.15);
                    }
                },
                c.SDL_EVENT_MOUSE_WHEEL => {
                    camera.distance = clamp(camera.distance * (1.0 - event.wheel.y * 0.10), 4.0, @max(24.0, bounds.radius * 1.2));
                },
                else => {},
            }
        }

        const ns = nowNs();
        const dt = clamp(@as(f32, @floatFromInt(ns - last_ns)) / 1_000_000_000.0, 0.001, 0.05);
        last_ns = ns;

        var move_x: f32 = 0;
        var move_z: f32 = 0;
        if (keyDown(SCAN_W)) {
            move_x -= @sin(camera.yaw);
            move_z -= @cos(camera.yaw);
        }
        if (keyDown(SCAN_S)) {
            move_x += @sin(camera.yaw);
            move_z += @cos(camera.yaw);
        }
        if (keyDown(SCAN_A)) {
            move_x -= @cos(camera.yaw);
            move_z += @sin(camera.yaw);
        }
        if (keyDown(SCAN_D)) {
            move_x += @cos(camera.yaw);
            move_z -= @sin(camera.yaw);
        }
        const move_len = @sqrt(move_x * move_x + move_z * move_z);
        if (move_len > 0.001) {
            move_x /= move_len;
            move_z /= move_len;
            const speed: f32 = if (keyDown(SCAN_LSHIFT)) 8.0 else 4.5;
            player.x += move_x * speed * dt;
            player.z += move_z * speed * dt;
            player.yaw = std.math.atan2(move_x, move_z);
            if (groundHeightAt(insts, inst_count, piece_count, stride, player.x, player.z)) |ground_y| {
                player.y = ground_y;
            }
            writeAvatar(avatar_instances[0..], player);
        }

        updateCameraNode(&kids[0], camera, player);
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
