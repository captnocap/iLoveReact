//! V8 binding for the world_loader embedded primitive.
//!
//! JS calls only on mount/unmount/status. The frame loop is world_loader.zig
//! itself, mounted under a React WorldLoader host node.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const world_loader = @import("world_loader.zig");
const world_window = @import("gpu/world_window.zig");

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
}

fn argToNodeId(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const node_f = argToF64(info, idx) orelse return null;
    return @trunc(@max(0.0, node_f));
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = std.heap.c_allocator.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

fn hostMount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const game_file = argToStringAlloc(info, 1) orelse {
        setReturnString(info, "error:MissingGameFile");
        return;
    };
    defer std.heap.c_allocator.free(game_file);
    const store_dir = argToStringAlloc(info, 2) orelse {
        setReturnString(info, "error:MissingStoreDir");
        return;
    };
    defer std.heap.c_allocator.free(store_dir);

    const host = v8_runtime.hostContext(info.getIsolate());
    world_loader.mount(host.io, host.environ, std.heap.c_allocator, node_id, game_file, store_dir) catch |e| {
        var buf: [96]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "error:{s}", .{@errorName(e)}) catch "error:mount";
        setReturnString(info, msg);
        return;
    };

    const status = world_loader.statusAlloc(std.heap.c_allocator, node_id) catch {
        setReturnString(info, "ok");
        return;
    };
    defer std.heap.c_allocator.free(status);
    setReturnString(info, status);
}

fn hostUnmount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.unmount(v8_runtime.hostContext(info.getIsolate()).io, node_id);
    setReturnString(info, "ok");
}

fn hostStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const status = world_loader.statusAlloc(std.heap.c_allocator, node_id) catch {
        setReturnString(info, "error:status");
        return;
    };
    defer std.heap.c_allocator.free(status);
    setReturnString(info, status);
}

// ── external iso camera (LOADERVIEW req_1757) ───────────────────────────────
// __compiled_world_set_camera(nodeId, px,py,pz, lx,ly,lz, fovDeg) drives the embedded
// loader's camera from the editor's already-solved IsoStage pose (eye + look + fov);
// _clear_camera returns it to the player-trailing game camera.

fn argF32(info: v8.FunctionCallbackInfo, idx: u32, fallback: f32) f32 {
    return if (argToF64(info, idx)) |v| @floatCast(v) else fallback;
}

fn hostSetCamera(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    world_loader.setExternalCamera(
        node_id,
        argF32(info, 1, 0),
        argF32(info, 2, 0),
        argF32(info, 3, 0),
        argF32(info, 4, 0),
        argF32(info, 5, 0),
        argF32(info, 6, 0),
        argF32(info, 7, 45),
    );
    setReturnString(info, "ok");
}

fn hostClearCamera(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearExternalCamera(node_id);
    setReturnString(info, "ok");
}

// ── live editor overlay (LIVEHOST req_1798) ─────────────────────────────────
// __compiled_world_set_live_pieces(nodeId, Float32Array rows) draws just-placed pieces
// as real box meshes WITHOUT a rebake; _clear_live_pieces drops them after a bake reload
// folds them into the baked world. The rows are the 12-stride unit-box instance layout
// pieceInstanceRows emits; world_loader owns a copy.

/// Raw bytes of a Float32Array / ArrayBufferView arg, borrowed in place (the loader
/// copies them straight away). Null if the arg isn't an array buffer view.
fn argView(info: v8.FunctionCallbackInfo, idx: u32) ?[]const u8 {
    if (info.length() <= idx) return null;
    const v = info.getArg(idx);
    if (!v.isArrayBufferView()) return null;
    const view: v8.ArrayBufferView = .{ .handle = @ptrCast(v.handle) };
    const byte_len = view.getByteLength();
    if (byte_len == 0) return &[_]u8{};
    const byte_off = view.getByteOffset();
    const ab = view.getBuffer();
    var shared = ab.getBackingStore();
    defer v8.BackingStore.sharedPtrReset(&shared);
    const bs = v8.BackingStore.sharedPtrGet(&shared);
    const base = bs.getData() orelse return null;
    const base_bytes: [*]const u8 = @ptrCast(base);
    return base_bytes[byte_off .. byte_off + byte_len];
}

fn hostSetLivePieces(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadRows");
        return;
    };
    world_loader.setLivePieces(node_id, bytes);
    setReturnString(info, "ok");
}

fn hostClearLivePieces(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearLivePieces(node_id);
    setReturnString(info, "ok");
}

// __compiled_world_set_live_lights(nodeId, Float32Array rows) carries the
// fixed 14-float point/spot wire validated by world_loader/live_lights.zig.
fn hostSetLiveLights(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadLights");
        return;
    };
    world_loader.setLiveLights(node_id, bytes);
    setReturnString(info, "ok");
}

fn hostClearLiveLights(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearLiveLights(node_id);
    setReturnString(info, "ok");
}

// ── live physics globals (GLOBALS req_2770) ─────────────────────────────────
// __compiled_world_set_physics(nodeId, Float32Array[13]) overrides the mounted
// loader's physics tuning THIS frame — the same 13 floats, same order, as the
// PHYSICS_CONFIG lump (encodePhysicsConfigLump): gravity, jumpSpeed, playerRadius,
// playerHeight, stepHeight, wallRestitution, bodyRestitution, walkableSidePushGrace,
// accelMult, surfaceFriction, surfaceRestitution, walkSpeed, runSpeed.
// _clear_physics reverts to the baked lump (or loader built-ins on a blank world).

fn hostSetPhysics(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadFloats");
        return;
    };
    if (!world_loader.setPhysicsConfig(node_id, bytes)) {
        setReturnString(info, "error:BadFloats");
        return;
    }
    setReturnString(info, "ok");
}

fn hostClearPhysics(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearPhysicsConfig(node_id);
    setReturnString(info, "ok");
}

// __compiled_world_set_live_mesh_props(nodeId, Uint8Array refs) draws just-placed MESH
// props (imported genmesh / Studio-cooked) by REFERENCING an already-resident mesh — no
// rebake (LIVEMESH req_1812). Each ref is 20 bytes: u32 keyHash, then f32 x,y,z,yaw.
fn hostSetLiveMeshProps(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadRefs");
        return;
    };
    world_loader.setLiveMeshProps(node_id, bytes);
    setReturnString(info, "ok");
}

// __compiled_world_set_live_mesh_props2(nodeId, Uint8Array refs) — the v2 wire (SPINPROP
// req_3128): a 28-byte header per ref (u32 keyHash, f32 x,y,z,yaw,spinDegPerSec, u32
// matCount) then matCount×u32. The editor presence-gates on this door and falls back to
// the v1 push (no spin) when the host predates it.
fn hostSetLiveMeshProps2(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadRefs");
        return;
    };
    world_loader.setLiveMeshProps2(node_id, bytes);
    setReturnString(info, "ok");
}

fn hostClearLiveMeshProps(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearLiveMeshProps(node_id);
    setReturnString(info, "ok");
}

// __compiled_world_set_live_mesh_ghost(nodeId, Uint8Array ref) draws the armed mesh prop
// as the REAL mesh, translucent, at the snap target — a clearer ghost than the projected
// wireframe (LIVEMESH req_1841). One ref: u32 keyHash, then f32 x,y,z,yaw.
fn hostSetLiveMeshGhost(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadRef");
        return;
    };
    world_loader.setLiveMeshGhost(node_id, bytes);
    setReturnString(info, "ok");
}

fn hostClearLiveMeshGhost(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearLiveMeshGhost(node_id);
    setReturnString(info, "ok");
}

// __compiled_world_set_live_material(nodeId, hash, kind, wgsl, Float32Array data, opacity)
// queues a live editor face-skin material (LIVESKIN req_1843). kind 0 = shader: the loader
// materializes the WGSL recipe into a "live-mat:<hash>" tile a live mesh ref then wears.
fn hostSetLiveMaterial(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const hash: u32 = @trunc(@as(f64, argToF64(info, 1) orelse 0));
    const kind: u32 = @trunc(@as(f64, argToF64(info, 2) orelse 0));
    const wgsl = argToStringAlloc(info, 3) orelse {
        setReturnString(info, "error:BadWgsl");
        return;
    };
    defer std.heap.c_allocator.free(wgsl);
    const data = argView(info, 4) orelse &[_]u8{};
    const opacity: f32 = @floatCast(argToF64(info, 5) orelse 1.0);
    world_loader.setLiveMaterial(node_id, hash, kind, wgsl, data, opacity);
    setReturnString(info, "ok");
}

// __compiled_world_set_live_skin_boxes(nodeId, Uint8Array boxes) draws live procedurally-
// skinned building-piece faces (LIVEBLDSKIN req_1849). 32 bytes/box: cx,cy,cz, sx,sy,sz,
// yawDeg (f32), matHash (u32) — the loader renders each as a textured cube outset over baked.
fn hostSetLiveSkinBoxes(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadBoxes");
        return;
    };
    world_loader.setLiveSkinBoxes(node_id, bytes);
    setReturnString(info, "ok");
}

// __compiled_world_set_dirty_erase(nodeId, Uint8Array rects) erases the baked geometry a
// moved/deleted piece left at its old footprint, with no rebake (DIRTYRECT req_1891/1892).
// 24 bytes/rect: minX,minY,minZ, maxX,maxY,maxZ (f32). Empty clears all erases.
fn hostSetDirtyErase(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadRects");
        return;
    };
    world_loader.setDirtyErase(node_id, bytes);
    setReturnString(info, "ok");
}

// __compiled_world_set_hide_walls(nodeId, on) toggles the editor build pane's "disable walls"
// (req_2053): on != 0 hides every wall piece (collapses its rows live, no rebake) so you can
// see/edit a building's interior; 0 restores them.
fn hostSetHideWalls(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const on = (argToF64(info, 1) orelse 0) != 0;
    world_loader.setHideWalls(node_id, on);
    setReturnString(info, "ok");
}

// __compiled_world_ground_hit(nodeId, px, py, levelY?) -> ArrayBuffer [x, y, z] | null —
// the painted-terrain surface point under a WINDOW-space cursor (the same space as
// getMouseX()/SDL_GetMouseState, checked against the pane rect renderEmbedded stored).
// Resolved on the brush beam's EXACT code path (paintGroundHitAt → map_paint.surfaceHit
// over the RENDERED 121-grid floor mirror, req_2789) so placement and painting can never
// disagree about the ground (req_2666) — or about where the drawn surface is. levelY lifts
// the intersected surface by the active storey's elevation in metres (req_2744) — the
// returned y stays the TRUE terrain height; the cart adds the storey back. Null on a
// bad/unmounted node, a pre-camera boot frame, or a ray that misses every painted chunk
// — the cart falls back to its analytic flat plane.
var g_ground_hit_ret: [3]f32 = .{ 0, 0, 0 };

fn setReturnNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(info.getIsolate().initNull());
}

fn noopBackingStoreDeleter(_: ?*anyopaque, _: usize, _: ?*anyopaque) callconv(.c) void {}

/// Zero-copy ArrayBuffer over module-static floats (the v8_bindings_game_physics.zig
/// return pattern) — JS wraps it in a Float32Array; the next call overwrites it.
fn setReturnF32Buffer(info: v8.FunctionCallbackInfo, floats: []f32) void {
    const iso = info.getIsolate();
    const bytes = std.mem.sliceAsBytes(floats);
    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(bytes.ptr),
        bytes.len,
        noopBackingStoreDeleter,
        null,
    ) orelse {
        setReturnNull(info);
        return;
    };
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    info.getReturnValue().set(ab);
}

fn hostGroundHit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const px = argToF64(info, 1) orelse {
        setReturnNull(info);
        return;
    };
    const py = argToF64(info, 2) orelse {
        setReturnNull(info);
        return;
    };
    // Optional storey elevation in metres (req_2744): the terrain intersection
    // lifts by this so an upper-floor pick lands under the cursor. Absent = 0.
    const level_y = argToF64(info, 3) orelse 0;
    const hit = world_loader.groundHitAt(node_id, @floatCast(px), @floatCast(py), @floatCast(level_y)) orelse {
        setReturnNull(info);
        return;
    };
    g_ground_hit_ret = hit;
    setReturnF32Buffer(info, g_ground_hit_ret[0..]);
}

// __compiled_world_set_paint_mode(nodeId, on) arms/disarms in-viewport map painting
// (MAPPAINT req_2473): while on, the left button over this loader routes into the
// host map painter (framework/game/map) — strokes, brush beam, live terrain mirror
// and colliders all run host-side with zero JS per event. The tool itself is armed
// through the __map_* doors (v8_bindings_game_map.zig).
fn hostSetPaintMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const on = (argToF64(info, 1) orelse 0) != 0;
    world_loader.setPaintMode(node_id, on);
    setReturnString(info, "ok");
}

// __compiled_world_set_resident_meshes(nodeId, Uint8Array meshPropsLump) installs the editor's
// full cooked-asset catalog (FULLRES req_1909/1911/1912) so every compiled asset is resident and
// placeable with no rebake. `bytes` is a MESH_PROPS lump (meshes only); empty clears residency.
fn hostSetResidentMeshes(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadLump");
        return;
    };
    world_loader.setResidentMeshes(node_id, bytes);
    setReturnString(info, "ok");
}

// __compiled_world_set_player_model(Float32Array verts, Float32Array groupTable) stages the
// editor's EXPORTED player-role character as the loader's player figure (req_2780). Process-
// global (no nodeId): staged BEFORE a loader constructs, consumed by every construct whose
// gamefile has no player lump — the blank playtest world's case. Table rows are 8 floats
// [vertStart, vertCount, cx, cy, cz, r, g, b]; verts are stride-8, LOCAL to each group's
// center. Two empty arrays clear the staging (back to the stand-in figure).
fn hostSetPlayerModel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const verts = argView(info, 0) orelse {
        setReturnString(info, "error:BadVerts");
        return;
    };
    const table = argView(info, 1) orelse {
        setReturnString(info, "error:BadTable");
        return;
    };
    world_loader.setPendingPlayerModel(verts, table);
    setReturnString(info, "ok");
}

// __compiled_world_set_player_animation(Float32Array payload) stages the basic animation
// shapes generated for the pushed body (req_2781) — same staging discipline as the model
// door: process-global, consumed at construct when the gamefile carries no animation and
// the payload's node count matches the model's groups. Empty payload clears.
fn hostSetPlayerAnimation(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const payload = argView(info, 0) orelse {
        setReturnString(info, "error:BadPayload");
        return;
    };
    world_loader.setPendingPlayerAnimation(payload);
    setReturnString(info, "ok");
}

// __compiled_world_set_player_live_pose(nodeId, Float32Array n*9) — the CAPTURE feed
// (req_2786): per-node transforms pushed every solve tick override the clip sampler
// while fresh; _clear drops the override. Node-scoped: only the capture surface's
// loader wears the camera pose.
fn hostSetPlayerLivePose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const bytes = argView(info, 1) orelse {
        setReturnString(info, "error:BadPose");
        return;
    };
    world_loader.setPlayerLivePose(node_id, bytes);
    setReturnString(info, "ok");
}

fn hostClearPlayerLivePose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearPlayerLivePose(node_id);
    setReturnString(info, "ok");
}

// ── the pop-out window (WORLDWIN-0611) ──────────────────────────────────────
// __compiled_world_window(gameFile, storeDir, width, height) opens the
// second OS window (or reloads its gamefile when already open — the Compile
// button's case); _close and _status do what they say. Same ingredient as
// the embedded loader (the __compiled_world_ grep prefix), so the door costs
// no new build flag.

fn hostWindowOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const game_file = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "error:MissingGameFile");
        return;
    };
    defer std.heap.c_allocator.free(game_file);
    const store_dir = argToStringAlloc(info, 1) orelse {
        setReturnString(info, "error:MissingStoreDir");
        return;
    };
    defer std.heap.c_allocator.free(store_dir);
    const width: u32 = if (argToF64(info, 2)) |w| @trunc(@max(0.0, w)) else 1280;
    const height: u32 = if (argToF64(info, 3)) |h| @trunc(@max(0.0, h)) else 800;

    const host = v8_runtime.hostContext(info.getIsolate());
    world_window.open(host.io, host.environ, game_file, store_dir, width, height) catch |e| {
        var buf: [96]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "error:{s}", .{@errorName(e)}) catch "error:open";
        setReturnString(info, msg);
        return;
    };
    const status = world_window.statusAlloc(std.heap.c_allocator) catch {
        setReturnString(info, "ok");
        return;
    };
    defer std.heap.c_allocator.free(status);
    setReturnString(info, status);
}

fn hostWindowClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    world_window.close(v8_runtime.hostContext(info.getIsolate()).io);
    setReturnString(info, "ok");
}

fn hostWindowStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const status = world_window.statusAlloc(std.heap.c_allocator) catch {
        setReturnString(info, "error:status");
        return;
    };
    defer std.heap.c_allocator.free(status);
    setReturnString(info, status);
}

pub fn registerCompiledWorld(_: anytype) void {
    v8_runtime.registerHostFn("__compiled_world_mount", hostMount);
    v8_runtime.registerHostFn("__compiled_world_unmount", hostUnmount);
    v8_runtime.registerHostFn("__compiled_world_status", hostStatus);
    v8_runtime.registerHostFn("__compiled_world_set_camera", hostSetCamera);
    v8_runtime.registerHostFn("__compiled_world_clear_camera", hostClearCamera);
    v8_runtime.registerHostFn("__compiled_world_set_live_pieces", hostSetLivePieces);
    v8_runtime.registerHostFn("__compiled_world_clear_live_pieces", hostClearLivePieces);
    v8_runtime.registerHostFn("__compiled_world_set_live_lights", hostSetLiveLights);
    v8_runtime.registerHostFn("__compiled_world_clear_live_lights", hostClearLiveLights);
    v8_runtime.registerHostFn("__compiled_world_set_physics", hostSetPhysics);
    v8_runtime.registerHostFn("__compiled_world_clear_physics", hostClearPhysics);
    v8_runtime.registerHostFn("__compiled_world_set_live_mesh_props", hostSetLiveMeshProps);
    v8_runtime.registerHostFn("__compiled_world_set_live_mesh_props2", hostSetLiveMeshProps2);
    v8_runtime.registerHostFn("__compiled_world_clear_live_mesh_props", hostClearLiveMeshProps);
    v8_runtime.registerHostFn("__compiled_world_set_live_mesh_ghost", hostSetLiveMeshGhost);
    v8_runtime.registerHostFn("__compiled_world_clear_live_mesh_ghost", hostClearLiveMeshGhost);
    v8_runtime.registerHostFn("__compiled_world_set_live_material", hostSetLiveMaterial);
    v8_runtime.registerHostFn("__compiled_world_set_live_skin_boxes", hostSetLiveSkinBoxes);
    v8_runtime.registerHostFn("__compiled_world_set_dirty_erase", hostSetDirtyErase);
    v8_runtime.registerHostFn("__compiled_world_set_hide_walls", hostSetHideWalls);
    v8_runtime.registerHostFn("__compiled_world_ground_hit", hostGroundHit);
    v8_runtime.registerHostFn("__compiled_world_set_paint_mode", hostSetPaintMode);
    v8_runtime.registerHostFn("__compiled_world_set_resident_meshes", hostSetResidentMeshes);
    v8_runtime.registerHostFn("__compiled_world_set_player_model", hostSetPlayerModel);
    v8_runtime.registerHostFn("__compiled_world_set_player_animation", hostSetPlayerAnimation);
    v8_runtime.registerHostFn("__compiled_world_set_player_live_pose", hostSetPlayerLivePose);
    v8_runtime.registerHostFn("__compiled_world_clear_player_live_pose", hostClearPlayerLivePose);
    v8_runtime.registerHostFn("__compiled_world_window", hostWindowOpen);
    v8_runtime.registerHostFn("__compiled_world_window_close", hostWindowClose);
    v8_runtime.registerHostFn("__compiled_world_window_status", hostWindowStatus);
}
