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
//! lump): authored objects lower to keyed primitive instances. Boxes are the
//! common path; ramps, cylinders, and spheres carry semantic prop/build shapes
//! without reintroducing JS. 3D is the ONLY path — there is no 2D tile grid and
//! no flag to gate it.
//!
//! Build:
//!   zig build app -Dapp-name=world_loader -Dapp-source=framework/world_loader.zig \
//!     -Duse-v8=false -Dhas-gpu=true -Doptimize=ReleaseFast
//! Run (headless self-capture):
//!   ZIGOS_HEADLESS=1 ZIGOS_SCREENSHOT=1 ZIGOS_SCREENSHOT_OUTPUT=out.png \
//!     ZIGOS_SCREENSHOT_FRAMES=8 ./zig-out/bin/world_loader [game-file.b64]

const std = @import("std");
const c = @import("c.zig").imports;
const wgpu = @import("wgpu");
const gpu = @import("gpu/gpu.zig");
const capture = @import("gpu/capture.zig");
const scene3d = @import("gpu/3d.zig");
const layout = @import("layout.zig");
const text_engine = @import("primitive/text.zig");
const game_physics = @import("game/physics.zig");
const Node = layout.Node;
const log = std.debug;

const config = @import("world_loader/config.zig");
const WIN_W = config.WIN_W;
const WIN_H = config.WIN_H;
const DEFAULT_FIXTURE = config.DEFAULT_FIXTURE;
const STORE_DIR = config.STORE_DIR;
const MAX_FRAMES = config.MAX_FRAMES;
const MAX_EMBEDDED_LOADERS = config.MAX_EMBEDDED_LOADERS;

const Vec3 = @import("world_loader/state.zig").Vec3;
const player_assets = @import("world_loader/player_assets.zig");

pub fn setPendingPlayerModel(verts_bytes: []const u8, table_bytes: []const u8) void {
    player_assets.setPendingPlayerModel(verts_bytes, table_bytes);
}

pub fn setPendingPlayerAnimation(bytes: []const u8) void {
    player_assets.setPendingPlayerAnimation(bytes);
}

pub fn setPendingPlayerSkin(verts_bytes: []const u8, bones_bytes: []const u8, solve: bool) void {
    player_assets.setPendingPlayerSkin(verts_bytes, bones_bytes, solve);
}

pub fn setPlayerLivePose(node_id: u32, bytes: []const u8) void {
    player_assets.setPlayerLivePose(node_id, bytes);
}

pub fn clearPlayerLivePose(node_id: u32) void {
    player_assets.clearPlayerLivePose(node_id);
}
const runtime_mod = @import("world_loader/runtime.zig");
pub const Runtime = runtime_mod.Runtime;
const runtime_lifecycle = @import("world_loader/runtime_lifecycle.zig");
const runtime_live_scene = @import("world_loader/runtime_live_scene.zig");
const runtime_stream = @import("world_loader/runtime_stream.zig");
const runtime_interaction = @import("world_loader/runtime_interaction.zig");

const MountedLoader = struct {
    active: bool = false,
    runtime: ?*Runtime = null,
};

var g_mounted_loaders: [MAX_EMBEDDED_LOADERS]MountedLoader = [_]MountedLoader{.{}} ** MAX_EMBEDDED_LOADERS;

pub const MapMemoryStats = runtime_mod.MapMemoryStats;

/// Aggregate every mounted loader's Map Paint projection without allocating.
/// Called by the telemetry door on the same frame thread that mounts/unmounts
/// runtimes; the foliage worker contributes only through per-set atomics.
pub fn mapMemoryStats() MapMemoryStats {
    var stats: MapMemoryStats = .{};
    for (&g_mounted_loaders) |*entry| {
        if (!entry.active) continue;
        const runtime = entry.runtime orelse continue;
        stats.add(runtime.mapMemoryStats());
    }
    return stats;
}

const live_inputs = @import("world_loader/live_inputs.zig");
pub const PHYSICS_CONFIG_FLOATS = live_inputs.PHYSICS_CONFIG_FLOATS;
pub const setPhysicsConfig = live_inputs.setPhysicsConfig;
pub const clearPhysicsConfig = live_inputs.clearPhysicsConfig;
pub const setLivePieces = live_inputs.setLivePieces;
pub const clearLivePieces = live_inputs.clearLivePieces;
pub const setLiveLights = live_inputs.setLiveLights;
pub const clearLiveLights = live_inputs.clearLiveLights;
pub const setLiveMeshProps = live_inputs.setLiveMeshProps;
pub const setLiveMeshProps2 = live_inputs.setLiveMeshProps2;
pub const setLiveMeshProps3 = live_inputs.setLiveMeshProps3;
pub const clearLiveMeshProps = live_inputs.clearLiveMeshProps;
pub const setLiveMaterial = live_inputs.setLiveMaterial;
pub const setLiveSkinBoxes = live_inputs.setLiveSkinBoxes;
pub const setDirtyErase = live_inputs.setDirtyErase;
pub const setHideWalls = live_inputs.setHideWalls;
pub const setResidentMeshes = live_inputs.setResidentMeshes;
pub const setLiveMeshGhost = live_inputs.setLiveMeshGhost;
pub const clearLiveMeshGhost = live_inputs.clearLiveMeshGhost;
const pendingCamFor = live_inputs.pendingCamFor;
const pendingLiveFor = live_inputs.pendingLiveFor;
const setPendingCam = live_inputs.setPendingCam;
const applyPendingCam = live_inputs.applyPendingCam;
const applyPendingPhysics = live_inputs.applyPendingPhysics;
const applyPendingLive = live_inputs.applyPendingLive;
const applyLiveColliders = live_inputs.applyLiveColliders;

const paint_surface = @import("world_loader/paint_surface.zig");
const applyPaintLayer = @import("world_loader/paint_runtime.zig").applyPaintLayer;

pub fn setPaintMode(node_id: u32, enabled: bool) void {
    paint_surface.setPaintMode(node_id, enabled);
}

pub fn paintArmed(node_id: u32) bool {
    return paint_surface.paintArmed(node_id);
}

pub fn anyPaintArmed() bool {
    return paint_surface.anyPaintArmed();
}

pub const PaintPhase = paint_surface.PaintPhase;

pub fn paintPointer(io: std.Io, node_id: u32, phase: PaintPhase, mx: f32, my: f32) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    paint_surface.paintPointer(runtime, io, phase, mx, my);
}

pub fn groundHitAt(node_id: u32, mx: f32, my: f32, level_y: f32) ?[3]f32 {
    const entry = findMounted(node_id) orelse return null;
    const runtime = entry.runtime orelse return null;
    return paint_surface.groundHitAt(runtime, mx, my, level_y);
}

const paintGroundHitAt = paint_surface.paintGroundHitAt;
const paintWaterSurface = paint_surface.paintWaterSurface;

fn findMounted(node_id: u32) ?*MountedLoader {
    for (&g_mounted_loaders) |*entry| {
        const runtime = entry.runtime orelse continue;
        if (entry.active and runtime.node_id == node_id) return entry;
    }
    return null;
}

fn findVacantMounted() ?*MountedLoader {
    for (&g_mounted_loaders) |*entry| {
        if (!entry.active) return entry;
    }
    return null;
}

pub fn mount(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node_id: u32, game_file: []const u8, store_dir: []const u8) !void {
    if (node_id == 0) return error.BadNodeId;
    unmount(io, node_id);
    const entry = findVacantMounted() orelse return error.TooManyWorldLoaders;
    entry.runtime = try Runtime.create(io, environ, allocator, game_file, store_dir, node_id);
    entry.active = true;
}

pub fn unmount(io: std.Io, node_id: u32) void {
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| runtime.destroy(io);
        entry.runtime = null;
        entry.active = false;
    }
}

fn runtimeForNode(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node: *Node) !*Runtime {
    if (node.id == 0) return error.BadNodeId;
    if (findMounted(node.id)) |entry| {
        if (entry.runtime) |runtime| return runtime;
    }
    const game_file = node.world_loader_game_file orelse "zig-out/game/hmsc.gamefile";
    const store_dir = node.world_loader_store_dir orelse STORE_DIR;
    try mount(io, environ, allocator, node.id, game_file, store_dir);
    const entry = findMounted(node.id) orelse return error.MountFailed;
    return entry.runtime orelse error.MountFailed;
}

pub fn renderEmbedded(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    const runtime = runtimeForNode(io, environ, allocator, node) catch |err| {
        log.print("[loader] embedded mount/render failed for node {d}: {any}\n", .{ node.id, err });
        return false;
    };
    runtime.last_aspect = w / @max(h, 1); // streaming's sight culling needs the real pane shape
    applyPendingCam(runtime); // LOADERVIEW req_1757: editor iso pose, re-applied each frame
    // [live-diag req_1812] RJIT_LIVE_PROBE=1: inject ONE bright box at the camera's look
    // target so a headless shot proves whether the live overlay RENDERS at all (isolates
    // the Zig draw path from the JS push). Only when nothing real is set for this node.
    if (environ.get("RJIT_LIVE_PROBE") != null) {
        const cur = pendingLiveFor(node.id);
        if (cur == null or cur.?.count == 0) {
            const lk = runtime.camera.ext_look;
            var row = [_]f32{ lk.x, lk.y + 2, lk.z, 0, 0, 0, 6, 6, 6, 1, 0, 0 }; // red 6m cube
            setLivePieces(node.id, std.mem.sliceAsBytes(row[0..]));
            log.print("[live-probe] injected red box at ({d:.1},{d:.1},{d:.1})\n", .{ lk.x, lk.y + 2, lk.z });
        }
    }
    applyPendingLive(runtime); // LIVEHOST req_1798: just-placed pieces, drawn without a rebake
    applyLiveColliders(runtime, runtime_live_scene); // req_2792: those same pieces COLLIDE — walls are solid in playtest
    applyPendingPhysics(runtime); // GLOBALS req_2770: live physics tuning, read by the next step
    // MAPPAINT req_2473: the pane rect feeds the screen→ray mapping; the paint
    // layer mirrors painted chunks + colliders and dresses the brush beam.
    runtime.paint_last_x = x;
    runtime.paint_last_y = y;
    runtime.paint_last_w = w;
    runtime.paint_last_h = h;
    applyPaintLayer(runtime, io);
    runtime.stepNow(io, environ);
    runtime_lifecycle.ensureMaterials(runtime, io, environ);
    const ok = scene3d.render(io, environ, &runtime.root, x, y, w, h, opacity);
    // Interaction HUD (PROPUSE req_0624) — queued after the world quad so the
    // image-boundary segmentation draws it on top, inside this pane.
    if (ok) runtime_interaction.drawHud(runtime, x, y, w, h);
    return ok;
}

/// WORLDWIN-0611: step a mounted runtime and render it into a CALLER-OWNED
/// detached target — the pop-out window path. Unlike renderEmbedded nothing
/// is queued into the main window's 2D stream; the returned view is the
/// window's to blit. The runtime must already be mounted (mount()).
pub fn renderDetachedView(io: std.Io, environ: *const std.process.Environ.Map, node_id: u32, target: *scene3d.DetachedTarget, w: f32, h: f32) ?*wgpu.TextureView {
    const entry = findMounted(node_id) orelse return null;
    const runtime = entry.runtime orelse return null;
    runtime.last_aspect = w / @max(h, 1);
    runtime.stepNow(io, environ);
    runtime_lifecycle.ensureMaterials(runtime, io, environ);
    return scene3d.renderDetached(io, environ, target, &runtime.root, w, h);
}

/// WORLDWIN + PROPUSE req_0624: queue the interaction HUD prims for a
/// window-mounted runtime at (0,0,w,h). The window's frame draws them into
/// its own pass (world_window.zig owns globals/upload/reset around it).
pub fn drawHudForWindow(node_id: u32, w: f32, h: f32) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime_interaction.drawHud(runtime, 0, 0, w, h);
}

pub fn mouseLook(node_id: u32, dx: f32, dy: f32) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime.mouseLook(dx, dy);
}

/// LOADERVIEW req_1757: drive the camera from the editor's already-solved iso pose
/// (eye position + look target + fov degrees) instead of trailing the player. The pose
/// SNAPS each frame (no smoothing/spring-arm) so it tracks orbit/zoom drag frame-exact.
/// JS owns the solve (GAME_CAMERA.solve), so the render matches its picking ray.
pub fn setExternalCamera(node_id: u32, px: f32, py: f32, pz: f32, lx: f32, ly: f32, lz: f32, fov_degrees: f32) void {
    const pos = Vec3{ .x = px, .y = py, .z = pz };
    const look = Vec3{ .x = lx, .y = ly, .z = lz };
    // Pending table = source of truth (re-applied each renderEmbedded frame, survives the
    // lazy mount); also poke a live runtime so a mounted view turns this frame.
    setPendingCam(node_id, pos, look, fov_degrees);
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| {
            runtime.camera.external = true;
            runtime.camera.ext_pos = pos;
            runtime.camera.ext_look = look;
            runtime.camera.ext_fov = fov_degrees;
        }
    }
}

/// Return the camera to the player-trailing game camera (LOADERVIEW req_1757).
pub fn clearExternalCamera(node_id: u32) void {
    if (pendingCamFor(node_id)) |p| p.set = false;
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| {
            runtime.camera.external = false;
            runtime.camera.initialized = false; // re-seed the trailing camera cleanly
        }
    }
}

/// True when this loader node is editor-driven (external camera set). The engine uses
/// it to NOT capture the pointer for in-world look (LOADERVIEW req_1776) — so the
/// editor's own drag/keys reach its JS overlay instead of walking the game player.
pub fn isExternalCamera(node_id: u32) bool {
    if (pendingCamFor(node_id) != null) return true;
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| return runtime.camera.external;
    }
    return false;
}

pub fn setAiming(node_id: u32, aiming: bool) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime.setAiming(aiming);
}

pub fn statusAlloc(allocator: std.mem.Allocator, node_id: u32) ![]u8 {
    const entry = findMounted(node_id) orelse return try allocator.dupe(u8, "unmounted");
    const runtime = entry.runtime orelse return try allocator.dupe(u8, "unmounted");
    return runtime.statusAlloc(allocator);
}

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.c_allocator;
    game_physics.configureDiagnostics(init.environ_map);

    var args_list: std.ArrayList([:0]const u8) = .empty;
    defer args_list.deinit(allocator);
    var args_it = std.process.Args.Iterator.init(init.minimal.args);
    while (args_it.next()) |a| try args_list.append(allocator, a);
    const args = args_list.items;
    var path: []const u8 = DEFAULT_FIXTURE;
    for (args[1..]) |a| {
        if (!std.mem.startsWith(u8, a, "--")) path = a;
    }

    var runtime: Runtime = undefined;
    runtime.initInPlace(init.io, init.environ_map, allocator, path, STORE_DIR, 0) catch |err| return err;
    defer runtime.deinit(init.io);

    // ── render the constructed scene (stateless GPU substrate) ───────────
    if (!c.SDL_Init(c.SDL_INIT_VIDEO)) {
        log.print("[loader] SDL_Init failed\n", .{});
        return error.SDLInitFailed;
    }
    defer c.SDL_Quit();

    const headless = init.environ_map.get("ZIGOS_HEADLESS") != null;
    const flags: u64 = if (headless) c.SDL_WINDOW_HIDDEN else 0;
    const window = c.SDL_CreateWindow("world_loader", WIN_W, WIN_H, flags) orelse {
        log.print("[loader] SDL_CreateWindow failed\n", .{});
        return error.WindowFailed;
    };

    gpu.init(init.io, init.environ_map, window) catch |err| {
        log.print("[loader] gpu.init failed: {any}\n", .{err});
        return err;
    };
    defer gpu.deinit();
    capture.init(init.environ_map);
    defer capture.deinit(init.io);

    // Text for the interaction HUD (PROPUSE req_0624) — same system-font
    // fallback chain the engine uses. Missing fonts degrade gracefully:
    // drawTextLine no-ops without a face, the loading bar still draws.
    var te: ?text_engine.TextEngine = text_engine.TextEngine.initHeadless("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") catch
        text_engine.TextEngine.initHeadless("/usr/share/fonts/dejavu/DejaVuSans.ttf") catch // Alpine (font-dejavu)
        text_engine.TextEngine.initHeadless("/System/Library/Fonts/Supplemental/Arial.ttf") catch
        text_engine.TextEngine.initHeadless("C:/Windows/Fonts/segoeui.ttf") catch null;
    if (te) |*engine_ref| {
        gpu.initText(init.environ_map, engine_ref.library, engine_ref.face, engine_ref.fallback_faces, engine_ref.fallback_count);
        if (engine_ref.face_bold != null) gpu.setBoldFace(engine_ref.face_bold);
    } else {
        log.print("[loader] no system font found — HUD prompts render without text\n", .{});
    }
    defer if (te) |*engine_ref| engine_ref.deinit();

    const screenshotting = capture.isScreenshotMode();
    if (!screenshotting) log.print("[loader] live window — close it or press ESC to exit (WASD move, Shift run, Space jump, mouse look, RMB aim)\n", .{});
    if (!headless and !screenshotting) {
        _ = c.SDL_SetWindowRelativeMouseMode(window, true);
    }

    var running = true;
    while (running) {
        runtime_stream.pollStandaloneEvents(&runtime, &running);
        runtime.stepNow(init.io, init.environ_map);
        if (screenshotting and runtime.frame % 30 == 0) {
            // what does the LIVE physics set hold under the player's column?
            var covering: usize = 0;
            var best_top: f32 = -1.0e9;
            var ri: usize = 0;
            while (ri < runtime.physics_colliders.rect_count) : (ri += 1) {
                const r = runtime.physics_colliders.values[game_physics.INPUT_HEADER_FLOATS + ri * game_physics.RECT_FLOATS ..][0..game_physics.RECT_FLOATS];
                if (runtime.player.x >= r[0] and runtime.player.z >= r[1] and runtime.player.x <= r[2] and runtime.player.z <= r[3]) {
                    covering += 1;
                    if (r[4] > best_top) best_top = r[4];
                }
            }
            log.print("[loader] f{d} player y={d:.3} vy={d:.3} grounded={} rects={d} underCol={d} underTop={d:.2}\n", .{
                runtime.frame, runtime.player.y, runtime.player.vy, runtime.player.grounded, runtime.physics_colliders.rect_count, covering, best_top,
            });
        }
        runtime_lifecycle.ensureMaterials(&runtime, init.io, init.environ_map);
        _ = scene3d.render(init.io, init.environ_map, &runtime.root, 0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H), 1.0);
        // Interaction HUD over the world quad (PROPUSE req_0624).
        runtime_interaction.drawHud(&runtime, 0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H));
        gpu.frame(init.io, init.environ_map, 0.52, 0.62, 0.74); // sky-ish clear so the ground reads against it

        if (screenshotting) {
            if (capture.tick(null) or runtime.frame >= MAX_FRAMES) break; // captured → exit
        } else {
            c.SDL_Delay(16); // ~60fps cap so a static scene doesn't spin the CPU
        }
    }
    log.print("[loader] done after {d} frames — player x={d:.2} y={d:.2} z={d:.2} vy={d:.2} grounded={}\n", .{
        runtime.frame, runtime.player.x, runtime.player.y, runtime.player.z, runtime.player.vy, runtime.player.grounded,
    });
}
