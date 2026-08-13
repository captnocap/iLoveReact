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
const build_options = @import("build_options");
const module_build = build_options.dev_native_modules and build_options.dev_game_module;
const gpu = if (module_build) @import("dev_modules/gpu_api.zig") else @import("gpu/gpu.zig");
const capture = @import("gpu/capture.zig");
const scene3d = @import("dev_modules/scene3d_runtime.zig");
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
const MOUNT_RETRY_BACKOFF_MS = config.MOUNT_RETRY_BACKOFF_MS;

const Vec3 = @import("world_loader/state.zig").Vec3;
const player_assets = @import("world_loader/player_assets.zig");
const character_assets = @import("world_loader/character_assets.zig");
const character_specimen = @import("gpu/character_specimen.zig");
const character_animation = @import("world_loader/animation.zig");
const character_camera = @import("world_loader/camera.zig");
const npc_character_session = @import("world_loader/npc_character_session.zig");
pub const player_character_pose = @import("world_loader/player_character_pose.zig");
const character_hashes = @import("skeleton/character_hashes.zig");
pub const pose_stream = player_character_pose.pose_stream;
pub const rig_pose = player_character_pose.rig_pose;

comptime {
    if (npc_character_session.MAX_INSTANCES + 1 > scene3d.SKIN_POOL) {
        @compileError("mounted player + NPC session exceeds gpu/3d skin palette slots");
    }
}

pub fn setPendingPlayerCharacter(io: std.Io, request_json: []const u8) !void {
    try player_assets.setPendingPlayerCharacter(io, request_json);
}

pub fn clearPendingPlayerCharacter() void {
    player_assets.clearPendingPlayerCharacter();
}

pub fn playerCharacterPaletteJsonAlloc(allocator: std.mem.Allocator) ![]u8 {
    return player_assets.paletteJsonAlloc(allocator);
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

const MountFailure = struct {
    node_id: u32 = 0,
    source_hash: u64 = 0,
    retry_after_ms: i64 = 0,
};

var g_mount_failures: [MAX_EMBEDDED_LOADERS]MountFailure = [_]MountFailure{.{}} ** MAX_EMBEDDED_LOADERS;

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

fn mountSourceHash(game_file: []const u8, store_dir: []const u8) u64 {
    var hash = std.hash.Wyhash.init(0);
    hash.update(game_file);
    hash.update(&.{0});
    hash.update(store_dir);
    return hash.final();
}

fn findMountFailure(node_id: u32, source_hash: u64) ?*MountFailure {
    for (&g_mount_failures) |*failure| {
        if (failure.node_id == node_id and failure.source_hash == source_hash) return failure;
    }
    return null;
}

fn rememberMountFailure(node_id: u32, source_hash: u64, retry_after_ms: i64) void {
    const failure = findMountFailure(node_id, source_hash) orelse blk: {
        for (&g_mount_failures) |*candidate| {
            if (candidate.node_id == 0 or candidate.node_id == node_id) break :blk candidate;
        }
        break :blk &g_mount_failures[@as(usize, node_id) % g_mount_failures.len];
    };
    failure.* = .{ .node_id = node_id, .source_hash = source_hash, .retry_after_ms = retry_after_ms };
}

fn clearMountFailure(node_id: u32) void {
    for (&g_mount_failures) |*failure| {
        if (failure.node_id == node_id) failure.* = .{};
    }
}

pub const MountedCharacterRigView = struct {
    bone_ids: []const []const u8,
    bones: []const rig_pose.Bone,
};

fn requireMountedRuntime(node_id: u32) !*Runtime {
    if (node_id == 0) return error.BadNodeId;
    const entry = findMounted(node_id) orelse return error.WorldLoaderNotMounted;
    return entry.runtime orelse error.WorldLoaderNotMounted;
}

fn configurePlayerCharacterNodes(
    runtime: *Runtime,
    character: *const character_assets.CharacterAsset,
    bind: *const character_specimen.BindSpecimen,
    skin_geometry_key: []const u8,
    bind_geometry_key: []const u8,
) !void {
    try character_animation.configurePlayerCharacterSpecimens(
        runtime.kid_list.items,
        runtime.player_first_child,
        runtime.player_bind_child,
        .{
            .geometry_key = skin_geometry_key,
            .vertices = character.vertices,
            .vertex_count = character.vertex_count,
            .palette = character.palette,
            .bone_count = @intCast(character.boneCount()),
        },
        .{
            .geometry_key = bind_geometry_key,
            .vertices = bind.vertices,
            .vertex_count = bind.vertex_count,
        },
    );
}

fn disablePlayerCharacterNodes(runtime: *Runtime) bool {
    return character_animation.disablePlayerCharacterSpecimens(
        runtime.kid_list.items,
        runtime.player_first_child,
        runtime.player_bind_child,
    );
}

fn syncMountedNpcCharacterNodes(runtime: *Runtime) void {
    for (0..npc_character_session.MAX_INSTANCES) |slot| {
        const node_index = runtime.npc_first_child + slot;
        if (node_index >= runtime.kid_list.items.len) return;
        runtime.kid_list.items[node_index] = .{};
    }
    for (runtime.npc_character_session.instances, 0..) |*instance, slot| {
        const node_index = runtime.npc_first_child + slot;
        if (node_index >= runtime.kid_list.items.len) return;
        const node = &runtime.kid_list.items[node_index];
        node.scene3d_skin_geom_key = instance.geometry_key;
        node.scene3d_skin_vertices = instance.asset.vertices;
        node.scene3d_skin_vert_count = instance.asset.vertex_count;
        node.scene3d_skin_palette = instance.asset.palette;
        node.scene3d_skin_bone_count = @intCast(instance.asset.boneCount());
        node.scene3d_pos_x = instance.placement.position[0];
        node.scene3d_pos_y = instance.placement.position[1];
        node.scene3d_pos_z = instance.placement.position[2];
        node.scene3d_rot_y = instance.placement.yaw_radians * 180.0 / std.math.pi + 180.0 +
            instance.asset.facing_yaw_offset_degrees;
        node.scene3d_scale_x = 1;
        node.scene3d_scale_y = 1;
        node.scene3d_scale_z = 1;
        node.scene3d_color_r = 1;
        node.scene3d_color_g = 1;
        node.scene3d_color_b = 1;
        node.scene3d_color_a = 1;
    }
}

/// One mounted, revisioned door for strict saved-weight NPC instances. The
/// request owns exact transforms and stable instance IDs; native loading is
/// atomic and uses the same CharacterAsset validation path as the player.
pub fn npcCharacterSessionJsonAlloc(
    io: std.Io,
    allocator: std.mem.Allocator,
    request_json: []const u8,
) ![]u8 {
    const node_id = try npc_character_session.requestNodeId(allocator, request_json);
    const runtime = try requireMountedRuntime(node_id);
    // replace/close can release the assets currently borrowed by scene nodes.
    // Refresh those pointers on every dispatch exit, including a reply-allocation
    // failure after the session mutation has already committed.
    defer syncMountedNpcCharacterNodes(runtime);
    return npc_character_session.dispatch(
        &runtime.npc_character_session,
        io,
        allocator,
        node_id,
        request_json,
    );
}

/// Strictly load/hash-check a capture target into the mounted world's pending
/// slot. The returned rig view is borrowed only for the synchronous capture
/// callback; capture copies it and never becomes an asset owner.
pub fn loadMountedPlayerCharacterTarget(
    io: std.Io,
    node_id: u32,
    owner_id: []const u8,
    geometry_path: []const u8,
    skin_path: []const u8,
    skeleton_json: []const u8,
) !MountedCharacterRigView {
    const runtime = try requireMountedRuntime(node_id);
    var owner: player_character_pose.OwnerId = .{};
    try owner.set(owner_id);
    var next = try character_assets.loadFiles(
        io,
        runtime.allocator,
        geometry_path,
        skin_path,
        skeleton_json,
    );
    errdefer next.deinit();
    if (runtime.player_target_candidate) |candidate| candidate.deinit();
    runtime.player_target_candidate = next;
    runtime.player_target_candidate_owner = owner;
    const resident = &runtime.player_target_candidate.?;
    return .{ .bone_ids = resident.retargetBoneIds(), .bones = resident.rig_bones };
}

/// Atomically replace the reserved player slot with the candidate loaded for
/// this exact owner. All fallible preparation happens before the old target is
/// released, so a rejected capture open leaves the visible target intact.
pub fn activateMountedPlayerCharacterTarget(node_id: u32, owner_id: []const u8) !void {
    const runtime = try requireMountedRuntime(node_id);
    if (!runtime.player_target_candidate_owner.matches(owner_id)) return error.CharacterTargetOwnerMismatch;
    const candidate = &(runtime.player_target_candidate orelse return error.MissingCharacterTargetCandidate);

    var next_pose: player_character_pose.State = .{};
    try next_pose.resetRig(candidate.rig_bones, candidate.retargetBoneIds());
    try next_pose.activate(owner_id, .{ 0, 0, 0 }, candidate.local_rotations);
    var active_owner: player_character_pose.OwnerId = .{};
    try active_owner.set(owner_id);
    try runtime.player_geom_keys.ensureUnusedCapacity(runtime.allocator, 2);

    var next_bind = try character_specimen.extractBindSpecimen(
        runtime.allocator,
        candidate.vertices,
        candidate.vertex_count,
    );
    errdefer next_bind.deinit();
    const skin_geometry_key = try std.fmt.allocPrint(
        runtime.allocator,
        "player-character-{x}",
        .{std.hash.Wyhash.hash(0, std.mem.sliceAsBytes(candidate.vertices))},
    );
    errdefer runtime.allocator.free(skin_geometry_key);
    const bind_geometry_key = try std.fmt.allocPrint(
        runtime.allocator,
        "player-character-bind-{x}",
        .{std.hash.Wyhash.hash(0, std.mem.sliceAsBytes(next_bind.vertices))},
    );
    errdefer runtime.allocator.free(bind_geometry_key);

    // This is the last fallible operation. It validates both reserved indices
    // before mutating either borrowed node view, so every failure above leaves
    // the active owner, asset, bind copy, and nodes untouched.
    try configurePlayerCharacterNodes(
        runtime,
        candidate,
        &next_bind,
        skin_geometry_key,
        bind_geometry_key,
    );

    // The capture target replaces the character; any mounted motion document
    // resolved against the OLD palette dies with it.
    dropMountedPlayerMotion(runtime);
    const next = candidate.*;
    runtime.player_target_candidate = null;
    runtime.player_target_candidate_owner.clear();
    const previous = runtime.scene.player_character;
    var previous_bind = runtime.player_bind_specimen;
    runtime.scene.player_character = next;
    runtime.player_bind_specimen = next_bind;
    runtime.player_character_pose = next_pose;
    runtime.player_character_pose_faulted = false;
    runtime.player_target_active_owner = active_owner;
    runtime.player_target_camera_aspect = null;
    runtime.player_geom_keys.appendAssumeCapacity(skin_geometry_key);
    runtime.player_geom_keys.appendAssumeCapacity(bind_geometry_key);
    character_animation.placePlayerCharacterSpecimens(
        runtime.kid_list.items,
        runtime.player_first_child,
        runtime.player_bind_child,
        character_animation.characterDiagnosticAnchor(),
        next_bind.separation_x,
        runtime.scene.player_character.?.facing_yaw_offset_degrees,
    );
    if (previous) |old| old.deinit();
    if (previous_bind) |*old_bind| old_bind.deinit();
}

/// Publish one already-decoded target-local frame into an activated mounted
/// target. Success returns exactly the ingress frame ID for same-frame proof.
pub fn publishMountedPlayerCharacterPose(
    node_id: u32,
    owner_id: []const u8,
    frame: pose_stream.Frame,
) !u64 {
    const runtime = try requireMountedRuntime(node_id);
    if (runtime.scene.player_character == null) return error.MissingMountedCharacter;
    return runtime.player_character_pose.publishFrame(owner_id, frame);
}

/// Remove the current transaction but keep the owner and target mounted in
/// bind pose. Calibration and camera changes can publish again without load.
pub fn clearMountedPlayerCharacterPose(node_id: u32, owner_id: []const u8) void {
    const runtime = requireMountedRuntime(node_id) catch return;
    if (!(runtime.player_character_pose.clearPublished(owner_id) catch false)) return;
    const character = if (runtime.scene.player_character) |*value| value else return;
    const bind = runtime.player_character_pose.advance(0, .idle, 0) catch return;
    character.evaluate(bind.root_translation, bind.rotations()) catch {};
}

pub const MAX_MOTION_BYTES: usize = 64 << 20;

fn dropMountedPlayerMotion(runtime: *Runtime) void {
    runtime.player_character_pose.stopMotion();
    for (&runtime.player_motion) |*slot| {
        if (slot.*) |*document| document.deinit();
        slot.* = null;
    }
}

fn dropMountedPlayerMotionLayer(runtime: *Runtime, layer: usize) void {
    runtime.player_character_pose.stopMotionLayer(layer);
    if (runtime.player_motion[layer]) |*document| document.deinit();
    runtime.player_motion[layer] = null;
}

/// Mount one RJAN motion document from disk as the mounted player's pose
/// source (req_4285); an empty path stops playback and clips resume. The
/// `motion-` basename prefix is reserved for content-addressed takes and is
/// hash-verified on reopen, the saved-character law; other names decode and
/// validate only (the editable library case). Returns a compact JSON summary.
pub fn playMountedPlayerMotionJsonAlloc(
    io: std.Io,
    allocator: std.mem.Allocator,
    node_id: u32,
    path: []const u8,
    layer: usize,
) ![]u8 {
    const runtime = try requireMountedRuntime(node_id);
    if (layer >= player_character_pose.MAX_MOTION_LAYERS) return error.InvalidMotionLayer;
    if (path.len == 0) {
        dropMountedPlayerMotionLayer(runtime, layer);
        return allocator.dupe(u8, "{\"ok\":true,\"playing\":false}");
    }
    const character = if (runtime.scene.player_character) |*value| value else return error.MissingMountedCharacter;

    const bytes = try std.Io.Dir.cwd().readFileAlloc(io, path, runtime.allocator, .limited(MAX_MOTION_BYTES));
    defer runtime.allocator.free(bytes);
    const basename = std.fs.path.basename(path);
    if (std.mem.startsWith(u8, basename, "motion-") and std.mem.endsWith(u8, basename, ".rjan")) {
        const hash_text = basename["motion-".len .. basename.len - ".rjan".len];
        const expected = character_hashes.parseHex(hash_text) catch return error.NonContentAddressedPath;
        var actual: character_hashes.Hash = undefined;
        std.crypto.hash.sha2.Sha256.hash(bytes, &actual, .{});
        if (!std.mem.eql(u8, &expected, &actual)) return error.MotionArtifactHashMismatch;
    }
    var document = try player_character_pose.motion_document.decodeAlloc(runtime.allocator, bytes);
    errdefer document.deinit();

    dropMountedPlayerMotionLayer(runtime, layer);
    runtime.player_motion[layer] = document;
    const resident = &runtime.player_motion[layer].?;
    runtime.player_character_pose.playMotionLayer(resident, character.retargetBoneIds(), layer) catch |err| {
        resident.deinit();
        runtime.player_motion[layer] = null;
        return err;
    };

    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"playing\":true,\"name\":\"");
    for (resident.name) |byte| switch (byte) {
        '"' => try output.writer.writeAll("\\\""),
        '\\' => try output.writer.writeAll("\\\\"),
        0...31 => try output.writer.print("\\u{x:0>4}", .{byte}),
        else => try output.writer.writeByte(byte),
    };
    try output.writer.print(
        "\",\"durationSeconds\":{d},\"looping\":{s},\"channelCount\":{d}}}",
        .{
            resident.duration_seconds,
            if (resident.looping) "true" else "false",
            resident.channel_ids.len,
        },
    );
    return allocator.dupe(u8, output.written());
}

/// Workbench scrub: park one mixer layer's playhead at an exact time, or
/// release it back into playback with a negative time.
pub fn scrubMountedPlayerMotion(node_id: u32, layer: usize, seconds: f32) !void {
    const runtime = try requireMountedRuntime(node_id);
    if (seconds < 0) return runtime.player_character_pose.resumeMotionLayer(layer);
    return runtime.player_character_pose.scrubMotionLayer(layer, seconds);
}

/// Close only the candidate/active target owned by `owner_id`. A late close
/// from a replaced session cannot tear down the newer session's character.
pub fn closeMountedPlayerCharacterTarget(node_id: u32, owner_id: []const u8) void {
    const runtime = requireMountedRuntime(node_id) catch return;
    if (runtime.player_target_candidate_owner.matches(owner_id)) {
        if (runtime.player_target_candidate) |candidate| candidate.deinit();
        runtime.player_target_candidate = null;
        runtime.player_target_candidate_owner.clear();
    }
    if (!runtime.player_target_active_owner.matches(owner_id)) return;
    if (!disablePlayerCharacterNodes(runtime)) return;
    dropMountedPlayerMotion(runtime);
    _ = runtime.player_character_pose.clear(owner_id);
    runtime.player_target_active_owner.clear();
    runtime.player_target_camera_aspect = null;
    runtime.camera.external = false;
    runtime.camera.initialized = false;
    if (runtime.player_bind_specimen) |*bind| bind.deinit();
    runtime.player_bind_specimen = null;
    if (runtime.scene.player_character) |character| character.deinit();
    runtime.scene.player_character = null;
    runtime.player_character_pose.resetEmpty();
}

/// Re-fit only when the native pane aspect changes. Activation can precede the
/// WorldLoader's first paint, so the first real render corrects the default
/// 16:9 runtime aspect before stepping or drawing (USER ASK req_4254).
fn refreshMountedPlayerCharacterDiagnosticCamera(runtime: *Runtime) void {
    if (runtime.player_target_active_owner.value() == null) return;
    const bind = if (runtime.player_bind_specimen) |*value| value else return;
    if (runtime.player_target_camera_aspect) |framed_aspect| {
        if (framed_aspect == runtime.last_aspect) return;
    }
    if (!character_camera.frameCharacterDiagnostic(
        &runtime.camera,
        bind.bounds_min,
        bind.bounds_max,
        bind.separation_x,
        runtime.last_aspect,
    )) return;
    runtime.player_target_camera_aspect = runtime.last_aspect;
}

/// V8-facing v1 wire ingress for an already-mounted strict player character.
/// Empty bytes clear only the direct-host owner and restore clip fallback.
pub fn setMountedPlayerCharacterPoseBytes(node_id: u32, bytes: []const u8) !?u64 {
    const runtime = try requireMountedRuntime(node_id);
    const character = if (runtime.scene.player_character) |*value| value else return error.MissingMountedCharacter;
    if (bytes.len == 0) {
        _ = runtime.player_character_pose.clear(player_character_pose.HOST_OWNER);
        return null;
    }
    if (runtime.player_target_active_owner.value() != null and
        !runtime.player_target_active_owner.matches(player_character_pose.HOST_OWNER))
    {
        return error.CharacterPoseOwnedByCapture;
    }
    if (!runtime.player_character_pose.ownedBy(player_character_pose.HOST_OWNER)) {
        try runtime.player_character_pose.activate(
            player_character_pose.HOST_OWNER,
            runtime.player_character_pose.last_root_translation,
            character.local_rotations,
        );
    }
    return try runtime.player_character_pose.publishBytes(player_character_pose.HOST_OWNER, bytes);
}

pub fn mount(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node_id: u32, game_file: []const u8, store_dir: []const u8) !void {
    if (node_id == 0) return error.BadNodeId;
    unmount(io, node_id);
    const entry = findVacantMounted() orelse return error.TooManyWorldLoaders;
    entry.runtime = try Runtime.create(io, environ, allocator, game_file, store_dir, node_id);
    entry.active = true;
}

/// Explicit blank-world mount used by the modular Game boundary after the
/// cold host classifies the source as missing. This avoids using a Zig error
/// value as a cross-library protocol.
pub fn mountBlank(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node_id: u32, game_file: []const u8) !void {
    if (node_id == 0) return error.BadNodeId;
    unmount(io, node_id);
    const entry = findVacantMounted() orelse return error.TooManyWorldLoaders;
    entry.runtime = try Runtime.createBlank(io, environ, allocator, game_file, node_id);
    entry.active = true;
}

pub fn ensureBlankMounted(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node_id: u32, game_file: []const u8) !void {
    if (findMounted(node_id) != null) return;
    try mountBlank(io, environ, allocator, node_id, game_file);
}

pub fn unmount(io: std.Io, node_id: u32) void {
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| runtime.destroy(io);
        entry.runtime = null;
        entry.active = false;
    }
    clearMountFailure(node_id);
}

fn runtimeForNode(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node: *Node) !*Runtime {
    if (node.id == 0) return error.BadNodeId;
    if (findMounted(node.id)) |entry| {
        if (entry.runtime) |runtime| return runtime;
    }
    const game_file = node.world_loader_game_file orelse "zig-out/game/hmsc.gamefile";
    const store_dir = node.world_loader_store_dir orelse STORE_DIR;
    const source_hash = mountSourceHash(game_file, store_dir);
    const now_ms = std.Io.Clock.now(.awake, io).toMilliseconds();
    if (findMountFailure(node.id, source_hash)) |failure| {
        if (now_ms < failure.retry_after_ms) return error.MountBackoff;
    }
    mount(io, environ, allocator, node.id, game_file, store_dir) catch |err| {
        rememberMountFailure(node.id, source_hash, now_ms + MOUNT_RETRY_BACKOFF_MS);
        return err;
    };
    clearMountFailure(node.id);
    const entry = findMounted(node.id) orelse return error.MountFailed;
    return entry.runtime orelse error.MountFailed;
}

pub fn renderEmbedded(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    const runtime = runtimeForNode(io, environ, allocator, node) catch |err| {
        if (err == error.MountBackoff) return false;
        log.print("[loader] embedded mount/render failed for node {d}: {any}\n", .{ node.id, err });
        return false;
    };
    runtime.last_aspect = w / @max(h, 1); // streaming's sight culling needs the real pane shape
    applyPendingCam(runtime); // LOADERVIEW req_1757: editor iso pose, re-applied each frame
    refreshMountedPlayerCharacterDiagnosticCamera(runtime);
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
