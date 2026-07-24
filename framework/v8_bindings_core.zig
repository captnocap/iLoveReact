const std = @import("std");
const v8 = @import("v8");
const build_options = @import("build_options");

comptime {
    _ = @hasDecl(build_options, "is_lib");
}

const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");
const state = @import("state/dirty.zig");
const input = @import("primitive/input.zig");
const selection = @import("state/selection.zig");
const prepared_input = @import("state/prepared_input.zig");
const mouse_state = @import("state/mouse_state.zig");
const exec_async = @import("process/exec_async.zig");
const router = @import("primitive/router.zig");
const filedrop = @import("fs/filedrop.zig");
const localstore = @import("storage/localstore.zig");
const fswatch = @import("fs/fswatch.zig");
const latches = @import("state/latches.zig");
const animations = @import("gpu/animations.zig");
const scene3d = @import("gpu/3d.zig");
const mesh_journal_log = @import("gpu/mesh_journal_log.zig");
const mesh_import = @import("world/mesh_import.zig");
const model_source = @import("gpu/model_source.zig");
const meshdoc_format = @import("gpu/meshdoc_format.zig");
const material_tex = @import("gpu/material_tex.zig");
const paint_program = @import("gpu/paint_program.zig");
const capture = @import("gpu/capture.zig");
const root = @import("root");

// Retained source mesh + its path, so the live quality slider can re-decimate from the
// current document baseline at any level without re-reading the file. The baseline is
// reversible session state; Save persists the chosen displayed projection when one is
// active, and reopening makes that reduced topology the next baseline (req_3315).
//
// PAINT IS RESOLUTION-INDEPENDENT: g_source_colors is the authoritative per-face paint
// (at full-res facecount). Whatever quality is displayed, painting a displayed face
// writes back through g_face_to_source (displayed face → source face) into here, and a
// quality change re-derives the displayed colours from here. So paint survives every
// quality change and every LoD is just a projection of this one paint.
const system_signals = @import("ifttt/system_signals.zig");
const selection_watch = @import("ifttt/selection_watch.zig");
const event_bus = @import("diag/event_bus.zig");
const c = @import("engine.zig").c;

var g_content_store: std.AutoHashMap(u32, []u8) = undefined;
var g_content_store_inited: bool = false;
var g_content_store_next_id: u32 = 1;
var g_exec_executor: exec_async.Executor = .{};

fn ensureContentStore() void {
    if (!g_content_store_inited) {
        g_content_store = std.AutoHashMap(u32, []u8).init(std.heap.c_allocator);
        g_content_store_inited = true;
    }
}

fn infoCtx(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = infoCtx(info);
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = std.heap.c_allocator.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.Number.init(iso, value));
}

fn noopMeshActionBackingStoreDeleter(_: ?*anyopaque, _: usize, _: ?*anyopaque) callconv(.c) void {}

/// Return a borrowed static Uint32 buffer. The mesh-action drain owns its
/// storage for the process lifetime and overwrites it on the next drain.
fn setReturnU32Buffer(info: v8.FunctionCallbackInfo, words: []u32) void {
    const iso = info.getIsolate();
    const bytes = std.mem.sliceAsBytes(words);
    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(bytes.ptr),
        bytes.len,
        noopMeshActionBackingStoreDeleter,
        null,
    ) orelse {
        info.getReturnValue().set(iso.initNull());
        return;
    };
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    info.getReturnValue().set(ab);
}

fn newObject(info: v8.FunctionCallbackInfo) v8.Object {
    return v8.Object.init(info.getIsolate());
}

fn objectSetNumber(obj: v8.Object, ctx: v8.Context, key: []const u8, value: f64) void {
    const iso = ctx.getIsolate();
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, key), v8.Number.init(iso, value));
}

fn objectSetString(obj: v8.Object, ctx: v8.Context, key: []const u8, value: []const u8) void {
    const iso = ctx.getIsolate();
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, key), v8.String.initUtf8(iso, value));
}

fn argToI32(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toI32(infoCtx(info)) catch return null;
}

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(infoCtx(info)) catch return null;
}

fn argBytes(info: v8.FunctionCallbackInfo, idx: u32) ?[]const u8 {
    if (idx >= info.length()) return null;
    const value = info.getArg(idx);
    if (!value.isArrayBufferView()) return null;
    const view: v8.ArrayBufferView = .{ .handle = @ptrCast(value.handle) };
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

fn hostDevReloadSetPolicy(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw = argToI32(info, 0) orelse -1;
    const ok = if (comptime @hasDecl(root, "devReloadSetPolicy"))
        raw >= 0 and root.devReloadSetPolicy(@intCast(raw))
    else
        false;
    setReturnNumber(info, if (ok) 1 else 0);
}

fn hostDevReloadWaiting(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const waiting = if (comptime @hasDecl(root, "devReloadWaiting")) root.devReloadWaiting() else false;
    setReturnNumber(info, if (waiting) 1 else 0);
}

fn hostDevReloadApply(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = if (comptime @hasDecl(root, "devReloadApply")) root.devReloadApply() else false;
    setReturnNumber(info, if (ok) 1 else 0);
}

fn hostDevReloadRevision(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const revision = if (comptime @hasDecl(root, "devReloadRevision")) root.devReloadRevision() else 0;
    setReturnNumber(info, @floatFromInt(revision));
}

// __hostFlush now lives in framework/v8_bindings_reconciler.zig (single
// registration site shared by both v8_app and v8_tui_app). The pending-
// flush queue + drain + clear all moved there too.

fn hostGetInputTextForNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setReturnString(info, "");
        return;
    }
    const input_id = argToI32(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    if (input_id < 0) {
        setReturnString(info, "");
        return;
    }
    const text = input.getText(@intCast(input_id));
    if (text.len == 0) {
        setReturnString(info, "");
        return;
    }
    setReturnString(info, text);
}

fn hostLoadFileToBuffer(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    if (info.length() < 1) {
        setReturnNumber(info, 0);
        return;
    }
    const path = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(path);
    if (path.len == 0) {
        setReturnNumber(info, 0);
        return;
    }

    ensureContentStore();
    const data = std.Io.Dir.cwd().readFileAlloc(io, path, std.heap.c_allocator, .limited(64 * 1024 * 1024)) catch |e| {
        std.log.warn("[content-store] read failed path={s}: {}", .{ path, e });
        setReturnNumber(info, 0);
        return;
    };

    const next_id = g_content_store_next_id;
    g_content_store_next_id = next_id + 1;
    g_content_store.put(next_id, data) catch {
        std.heap.c_allocator.free(data);
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, next_id);
}

fn hostUploadFloatBuffer(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (bytes.len == 0 or bytes.len > 256 * 1024 * 1024 or bytes.len % @sizeOf(f32) != 0) {
        setReturnNumber(info, 0);
        return;
    }

    ensureContentStore();
    const data = std.heap.c_allocator.alloc(u8, bytes.len) catch {
        setReturnNumber(info, 0);
        return;
    };
    @memcpy(data, bytes);
    const next_id = g_content_store_next_id;
    g_content_store_next_id = next_id + 1;
    g_content_store.put(next_id, data) catch {
        std.heap.c_allocator.free(data);
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, next_id);
}

/// __scene3d_patch_dyn(slotId, float32Verts, vertCount) → bool. Imperative
/// HOST-OWNED dyn-slot vertex patch: overwrite an already-mounted dyn slot's
/// verts in place this instant, with NO reconciler update. Studio's face/vertex
/// drag streams baked verts here per frame so the live edit never round-trips
/// through React (setState only on mouse-up). Returns 0 if the slot isn't
/// claimed yet (the <Scene3D.Mesh dynamicKey> must mount it first) or the verts
/// are malformed; 1 on a successful GPU write. Verts are interleaved Vertex
/// (8 f32: pos3 + normal3 + uv2), the same layout the dynamic-geom path ships.
fn hostScene3DPatchDyn(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(id);
    const bytes = argBytes(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const count: u32 = @intCast(@max(0, argToI32(info, 2) orelse 0));
    if (bytes.len % @sizeOf(f32) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const verts: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, bytes));
    const ok = scene3d.patchDynSlotById(id, verts, count);
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __mesh_load_file(path) → JSON {"key","count","radius"} | "" on failure.
/// The drop-to-view door: parse a GLB/OBJ ENTIRELY in the host (no geometry crosses
/// the bridge), park its verts in the scene3d host stash under `key`, and seed the
/// orbit camera to frame it. The cart renders a <Scene3D.Mesh scene3dGeomKey={key}>
/// with NO verts — the first draw interns the stash and every later frame redraws it
/// natively. `key` is the file path (re-dropping the same file reuses the resident
/// mesh). Returns "" on any parse/stash failure (the cart leaves the view empty).
fn hostMeshLoadFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(path);
    if (path.len == 0) {
        setReturnString(info, "");
        return;
    }

    const io = v8_runtime.hostContext(info.getIsolate()).io;
    var mesh = mesh_import.loadFile(io, std.heap.c_allocator, path) catch |e| {
        std.log.warn("[mesh-load] {s}: {}", .{ path, e });
        setReturnString(info, "");
        return;
    };
    defer mesh.deinit(std.heap.c_allocator);

    // Keep the pristine full-res mesh for the quality slider (before setPaintTarget
    // rewrites UVs — positions are untouched, but copy now to be unambiguous).
    model_source.retain(path, mesh.verts, mesh.vert_count);

    // New document boundary: discard any focused part range carried by the previous
    // model before the incoming topology is installed (req_2953).
    scene3d.meshEditBeginModel();
    // Adopt this mesh as the paint target FIRST — it rewrites the verts' UVs to the
    // per-face paint atlas in place, so the stash (next) ships the paint-ready UVs.
    scene3d.setPaintTarget(path, mesh.verts, mesh.vert_count);
    scene3d.meshJournalClear(); // a fresh model is a new document — no inherited history
    if (!scene3d.stashHostMesh(path, mesh.verts, mesh.vert_count)) {
        setReturnString(info, "");
        return;
    }
    scene3d.orbitFrame(mesh.center, mesh.radius);
    state.markDirty();

    // Build {"key":"<escaped path>","count":N,"radius":R} for the cart to mount.
    var buf: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer buf.deinit();
    const w = &buf.writer;
    w.writeAll("{\"key\":\"") catch {
        setReturnString(info, "");
        return;
    };
    for (path) |ch| {
        switch (ch) {
            '"' => w.writeAll("\\\"") catch return,
            '\\' => w.writeAll("\\\\") catch return,
            0...8, 9...10, 11...31 => w.print("\\u{x:0>4}", .{ch}) catch return,
            else => w.writeByte(ch) catch return,
        }
    }
    w.print("\",\"count\":{d},\"radius\":{d:.6}}}", .{ mesh.vert_count, mesh.radius }) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, buf.written());
}

/// __mesh_preview_file(path) → JSON {"key","count","radius"} | "" on failure.
/// Preview-only GLB/OBJ load: parse and stash a renderable host mesh without adopting
/// it as the active edit/paint target. The project asset explorer uses this for its
/// side preview so hovering/opening a file there cannot clobber an already-open model
/// document's mesh journal, selections, paint target, or source geometry.
fn hostMeshPreviewFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(path);
    if (path.len == 0) {
        setReturnString(info, "");
        return;
    }

    const io = v8_runtime.hostContext(info.getIsolate()).io;
    var mesh = mesh_import.loadFile(io, std.heap.c_allocator, path) catch |e| {
        std.log.warn("[mesh-preview] {s}: {}", .{ path, e });
        setReturnString(info, "");
        return;
    };
    defer mesh.deinit(std.heap.c_allocator);

    const key = std.fmt.allocPrint(std.heap.c_allocator, "preview:{s}", .{path}) catch {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(key);
    if (!scene3d.stashHostMesh(key, mesh.verts, mesh.vert_count)) {
        setReturnString(info, "");
        return;
    }
    scene3d.orbitFrame(mesh.center, mesh.radius);
    state.markDirty();

    var buf: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer buf.deinit();
    const w = &buf.writer;
    w.writeAll("{\"key\":\"") catch {
        setReturnString(info, "");
        return;
    };
    for (key) |ch| {
        switch (ch) {
            '"' => w.writeAll("\\\"") catch return,
            '\\' => w.writeAll("\\\\") catch return,
            0...8, 9...10, 11...31 => w.print("\\u{x:0>4}", .{ch}) catch return,
            else => w.writeByte(ch) catch return,
        }
    }
    w.print("\",\"count\":{d},\"radius\":{d:.6}}}", .{ mesh.vert_count, mesh.radius }) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, buf.written());
}

/// __mesh_load_vertices(key, float32Verts, vertCount?) → JSON {"key","count","radius"} | "".
/// Adopt already-cooked scene3d triangle data into the same resident model-viewer path
/// as OBJ/GLB file imports. Once a model is installed into the editor, its source file
/// no longer matters; the viewer consumes the engine-owned interleaved vertex factor.
fn hostMeshLoadVertices(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const key = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(key);
    const bytes = argBytes(info, 1) orelse {
        setReturnString(info, "");
        return;
    };
    if (key.len == 0 or bytes.len == 0 or bytes.len % @sizeOf(f32) != 0) {
        setReturnString(info, "");
        return;
    }
    const verts: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, bytes));
    const requested_count = argToI32(info, 2) orelse @as(i32, @intCast(verts.len / mesh_import.FLOATS_PER_VERTEX));
    if (requested_count <= 0) {
        setReturnString(info, "");
        return;
    }

    var mesh = mesh_import.fromInterleaved(std.heap.c_allocator, verts, @intCast(requested_count)) catch |e| {
        std.log.warn("[mesh-load] cooked {s}: {}", .{ key, e });
        setReturnString(info, "");
        return;
    };
    defer mesh.deinit(std.heap.c_allocator);

    // Keep the original cooked factor for quality/paint projection, then adopt a
    // paint-ready working copy into the resident host stash.
    model_source.retain(key, mesh.verts, mesh.vert_count);
    scene3d.meshEditBeginModel();
    scene3d.setPaintTarget(key, mesh.verts, mesh.vert_count);
    scene3d.meshJournalClear(); // a fresh model is a new document — no inherited history
    if (!scene3d.stashHostMesh(key, mesh.verts, mesh.vert_count)) {
        setReturnString(info, "");
        return;
    }
    scene3d.orbitFrame(mesh.center, mesh.radius);
    state.markDirty();

    var buf: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer buf.deinit();
    const w = &buf.writer;
    w.writeAll("{\"key\":\"") catch {
        setReturnString(info, "");
        return;
    };
    for (key) |ch| {
        switch (ch) {
            '"' => w.writeAll("\\\"") catch return,
            '\\' => w.writeAll("\\\\") catch return,
            0...8, 9...10, 11...31 => w.print("\\u{x:0>4}", .{ch}) catch return,
            else => w.writeByte(ch) catch return,
        }
    }
    w.print("\",\"count\":{d},\"radius\":{d:.6}}}", .{ mesh.vert_count, mesh.radius }) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, buf.written());
}

/// __model_orbit_drag(dx, dy) — orbit the drop-to-view camera by a screen-space drag
/// delta (pixels). Mutates host orbit state + repaints; never re-renders the cart, so
/// dragging stays butter-smooth no matter the model size.
fn hostModelOrbitDrag(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dx: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const dy: f32 = @floatCast(argToF64(info, 1) orelse 0);
    scene3d.orbitDrag(dx, dy);
    state.markDirty();
}

/// __model_orbit_zoom(delta) — dolly the drop-to-view camera (wheel delta; sign only).
fn hostModelOrbitZoom(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const delta: f32 = @floatCast(argToF64(info, 0) orelse 0);
    scene3d.orbitZoom(delta);
    state.markDirty();
}

/// __model_orbit_pan(dx, dy) — slide the orbit PIVOT in the screen plane (pixels). Moves
/// the centre of rotation, not the eye, so you can drop the focus on a far corner of a
/// large model and edit it without camera gymnastics (req_2148).
fn hostModelOrbitPan(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dx: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const dy: f32 = @floatCast(argToF64(info, 1) orelse 0);
    scene3d.orbitPan(dx, dy);
    state.markDirty();
}

/// __model_orbit_lock(on) — freeze/unfreeze the mesh editor's orbit camera (req_2893).
/// While locked, EVERY camera motion (drag, wheel, pivot pan, double-click focus,
/// compass snap) no-ops in gpu/3d.zig — the gate sits where the JS doors and the
/// native input loop converge, so nothing can nudge the saved angle.
fn hostModelOrbitLock(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const on = (argToF64(info, 0) orelse 0) != 0;
    scene3d.orbitSetLocked(on);
}

/// __model_cam_pose() → "[yaw,pitch,dist,tx,ty,tz]" — read the mesh-editor orbit pose.
/// The cart's view-bookmark list (req_3067/req_3074) stores these; the host stays the
/// pose authority, the list stays authored data.
fn hostModelCamPose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const p = scene3d.orbitPose();
    var buf: [160]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "[{d},{d},{d},{d},{d},{d}]", .{ p[0], p[1], p[2], p[3], p[4], p[5] }) catch return;
    setReturnString(info, json);
}

/// __model_cam_set_pose(yaw, pitch, dist, tx, ty, tz) → 1|0 — jump the orbit camera to
/// a bookmarked pose. 0 when the camera lock (req_2893) holds the view.
fn hostModelCamSetPose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const yaw: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const pitch: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const dist: f32 = @floatCast(argToF64(info, 2) orelse 0);
    const tx: f32 = @floatCast(argToF64(info, 3) orelse 0);
    const ty: f32 = @floatCast(argToF64(info, 4) orelse 0);
    const tz: f32 = @floatCast(argToF64(info, 5) orelse 0);
    const ok = scene3d.orbitSetPose(yaw, pitch, dist, .{ tx, ty, tz });
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_bd_gizmo_set(x, y, z) — open (or re-seat) the backdrop move-gizmo session at
/// the reference image's world center (req_3080). The native input loop then drags the
/// arms exactly like the mesh gizmo; the cart polls __model_bd_gizmo_pos to follow.
fn hostModelBdGizmoSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const z: f32 = @floatCast(argToF64(info, 2) orelse 0);
    scene3d.bdGizmoSet(x, y, z);
    state.markDirty();
}

/// __model_bd_gizmo_clear() — end the backdrop move-gizmo session (panel closed / row
/// collapsed / backdrop hidden).
fn hostModelBdGizmoClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = v8.FunctionCallbackInfo.initFromV8(info_c);
    scene3d.bdGizmoClear();
    state.markDirty();
}

/// __model_bd_gizmo_pos() → "[x,y,z]" | "" — the session's live pose (the drag mutates
/// it host-side; the cart polls while the session is open and mirrors it into state).
fn hostModelBdGizmoPos(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (!scene3d.bdGizmoActive()) {
        setReturnString(info, "");
        return;
    }
    const p = scene3d.bdGizmoPos();
    var buf: [96]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "[{d},{d},{d}]", .{ p[0], p[1], p[2] }) catch return;
    setReturnString(info, json);
}

/// __model_session_json() → {"key","count","radius","undo","redo","atlas"} | "".
/// The resident mesh-editor session (req_2898): what model the host is STILL holding
/// live across a hot reload — edit mesh key/count, orbit radius, journal depths, and
/// whether an authored paint atlas exists (automatic blank layouts report false). The
/// remounted viewer compares this against its hot
/// twig and ADOPTS the live session instead of re-loading the stale seed.
fn hostModelSessionJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.c_allocator;
    if (scene3d.modelSessionJson(alloc)) |json| {
        defer alloc.free(json);
        setReturnString(info, json);
    } else setReturnString(info, "");
}

/// __model_focus_at(x, y) → bool. Re-centre the orbit on whatever the viewport pixel
/// (x,y) hits (double-click to recentre). Returns 1 on a hit (and repaints), 0 on a miss
/// (empty space — focus unchanged). The programmatic counterpart drives the same path.
fn hostModelFocusAt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const ok = scene3d.focusAt(x, y);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __mesh_set_face_groups(u32Groups) → 1|0. Adopt one authored-face id per SOURCE
/// triangle so the mesh editor selects/outlines whole n-gons instead of the fan
/// slivers a studio EditMesh triangulates into. Called once right after
/// __mesh_load_vertices; cleared by the next load. File imports never call it.
/// Groups arriving is what turns the paint atlas from all-loose triangle islands into
/// real authored-face islands, so this refreshes the paint layout (req_2515/req_2516).
fn hostMeshSetFaceGroups(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (bytes.len == 0 or bytes.len % @sizeOf(u32) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const groups: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, bytes));
    scene3d.meshEditSetFaceGroups(groups);
    if (scene3d.refreshPaintLayout()) state.markDirty();
    setReturnNumber(info, 1);
}

/// __mesh_set_face_materials(u32Rows) → 1|0. Restore RJMD's stable texture-role
/// index per render triangle immediately after the geometry/group load.
fn hostMeshSetFaceMaterials(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse return setReturnNumber(info, 0);
    if (bytes.len == 0 or bytes.len % @sizeOf(u32) != 0) return setReturnNumber(info, 0);
    const materials: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, bytes));
    setReturnNumber(info, if (scene3d.meshEditSetFaceMaterials(materials)) 1 else 0);
}

/// __mesh_texture_slot_assign(index) / _clear() mutate metadata on the selected
/// authored faces. Return the number of authored faces whose role changed.
fn hostMeshTextureSlotAssign(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const material: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const changed = scene3d.meshTextureSlotAssign(material);
    if (changed > 0) state.markDirty();
    setReturnNumber(info, changed);
}

fn hostMeshTextureSlotClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const changed = scene3d.meshTextureSlotAssign(std.math.maxInt(u32));
    if (changed > 0) state.markDirty();
    setReturnNumber(info, changed);
}

fn hostMeshTextureSlotRemove(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const material: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const changed = scene3d.meshTextureSlotRemove(material);
    if (changed > 0) state.markDirty();
    setReturnNumber(info, changed);
}

fn hostMeshTextureSlotSelect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const material: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const selected = scene3d.meshTextureSlotSelect(material);
    state.markDirty();
    setReturnNumber(info, selected);
}

/// __mesh_edit_mode(m) — set the selection mode: 0 none, 1 vertex, 2 edge, 3 face. The
/// host-native counterpart to the Studio's JS mode toolbar; selection lives in the host.
fn hostMeshEditMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const m: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 3));
    scene3d.meshEditSetMode(m);
    state.markDirty();
}

/// __mesh_edit_mirror(mask) — live mirror editing (req_2758): enable the X/Y/Z symmetry
/// planes (bit 0 = X, 1 = Y, 2 = Z). While a plane is on, every selection transform
/// (gizmo drag / nudge) also lands, reflected around that outliner part's local center,
/// on each moved vertex's position-matched twin — the Studio's req_1183/1186 symmetric
/// editing, host-native.
fn hostMeshEditMirror(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const mask: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 7));
    scene3d.meshEditSetMirror(mask);
    state.markDirty(); // the plane overlay appears/disappears with the toggle
}

/// __mesh_edit_pick(x, y, additive) → selected count. Pick the element under the pixel in
/// the current mode and fold it in (additive≠0 = shift toggle/extend). Returns the new
/// selected count in this mode, or -1 if there's no mesh. Repaints (face tint).
fn hostMeshEditPick(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const additive = (argToI32(info, 2) orelse 0) != 0;
    const n = scene3d.meshEditPick(x, y, additive);
    state.markDirty();
    setReturnNumber(info, n);
}

/// __mesh_edit_clear() — drop the current selection (and its face tint).
fn hostMeshEditClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = info;
    scene3d.meshEditClear();
    state.markDirty();
}

/// __mesh_edit_box(x0, y0, x1, y1, additive) → count. Marquee select every element inside
/// the screen rect (Alt+drag); additive≠0 unions with the pre-gesture snapshot. Repaints.
fn hostMeshEditBox(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x0: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y0: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const x1: f32 = @floatCast(argToF64(info, 2) orelse 0);
    const y1: f32 = @floatCast(argToF64(info, 3) orelse 0);
    const additive = (argToI32(info, 4) orelse 0) != 0;
    const n = scene3d.meshEditBox(x0, y0, x1, y1, additive);
    state.markDirty();
    setReturnNumber(info, n);
}

/// __mesh_edit_capture(on) — hand the model-editor input loop to the HOST (modelview).
/// While on, the engine owns orbit (middle-drag), select/marquee (left), zoom (wheel), and
/// focus (double-click) natively — zero JS per event. The cart sets it on a model load.
fn hostMeshEditCapture(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    scene3d.setMeshEditCapture((argToI32(info, 0) orelse 0) != 0);
}

/// __mesh_edit_focus(on) — set the Focus tool (left-drag pans the orbit pivot instead of
/// selecting). The cart toggles it with the Focus button.
fn hostMeshEditFocus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    scene3d.setMeshEditFocusTool((argToI32(info, 0) orelse 0) != 0);
}

/// __mesh_gizmo_tool(t) — set transform sub-tool: 0 move, 1 scale, 2 rotate.
fn hostMeshGizmoTool(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 2));
    scene3d.setMeshGizmoTool(t);
    state.markDirty();
}

/// __mesh_gizmo_nudge(axis, amount) → bool. Headless/test hook: translate the active
/// selection along X/Y/Z without needing a mouse drag or captured camera.
fn hostMeshGizmoNudge(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const axis: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 2));
    const amount: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const ok = scene3d.meshGizmoNudge(axis, amount);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __mesh_gizmo_scale_by(factor) → bool. Exact uniform scale around the active
/// selection pivot, journaled by the host as one undoable operation.
fn hostMeshGizmoScaleBy(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const factor: f32 = @floatCast(argToF64(info, 0) orelse 1);
    const ok = scene3d.meshGizmoScaleBy(factor);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

fn setMeshTopoReturn(info: v8.FunctionCallbackInfo, ok: bool) void {
    if (!ok) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const key = scene3d.meshEditActiveKey() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: [256]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"ok\":1,\"key\":\"{s}\",\"count\":{d}}}", .{ key, scene3d.meshEditActiveCount() }) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, json);
}

fn setMeshLcPreviewReturn(info: v8.FunctionCallbackInfo, ok: bool) void {
    if (!ok) {
        var buf: [512]u8 = undefined;
        const json = if (scene3d.meshLcFallbackReason()) |reason|
            std.fmt.bufPrint(&buf, "{{\"ok\":0,\"fallbackReason\":\"{s}\"}}", .{reason})
        else
            std.fmt.bufPrint(&buf, "{{\"ok\":0}}", .{});
        setReturnString(info, json catch "{\"ok\":0}");
        return;
    }
    const key = scene3d.meshEditActiveKey() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: [512]u8 = undefined;
    const json = if (scene3d.meshLcFallbackReason()) |reason|
        std.fmt.bufPrint(&buf, "{{\"ok\":1,\"key\":\"{s}\",\"count\":{d},\"fallbackReason\":\"{s}\"}}", .{ key, scene3d.meshEditActiveCount(), reason })
    else
        std.fmt.bufPrint(&buf, "{{\"ok\":1,\"key\":\"{s}\",\"count\":{d}}}", .{ key, scene3d.meshEditActiveCount() });
    setReturnString(info, json catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    });
}

/// __mesh_topo_extrude_edge(distance) → JSON {"ok","key","count"}. Extrude exactly
/// one selected welded edge, appending a bridged quad split into triangles.
fn hostMeshTopoExtrudeEdge(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const distance: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const ok = scene3d.meshTopoExtrudeEdge(distance);
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_topo_extrude_face(distance) → JSON {"ok","key","count"}. Extrude exactly
/// one selected authored face, capping it and adding side-wall quads.
fn hostMeshTopoExtrudeFace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const distance: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const ok = scene3d.meshTopoExtrudeFace(distance);
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_topo_create_face() → JSON {"ok","key","count"}. Fill a closed 3/4-edge
/// loop, or bridge two disjoint selected edges as a split quad.
fn hostMeshTopoCreateFace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = scene3d.meshTopoCreateFaceFromEdges();
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_topo_flip_faces() → JSON {"ok","key","count"}. Reverse the winding of
/// every selected authored face so its normal points to the opposite side. Geometry,
/// UV attachment, paint, grouping, and the face selection stay intact.
fn hostMeshTopoFlipFaces(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = scene3d.meshFlipSelectionWinding();
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_topo_weld() → JSON {"ok","key","count"}. Merge the selected vertices
/// at their center (req_3382): vertex mode welds the selected verts, edge mode
/// an edge's endpoints (edge collapse). Degenerated faces leave the mesh in the
/// same one-undo transaction.
fn hostMeshTopoWeld(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = scene3d.meshTopoWeldSelection();
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_topo_loop_cut() → JSON {"ok","key","count"}. Slice the mesh by the axis-aligned
/// plane across the ONE selected edge (normal = the edge's dominant world axis, through
/// its midpoint — req_2837: keeps the ring level on tapered shapes) — the host-native loop
/// cut. Straddling faces split; authored grouping carries through so each crossed face
/// becomes two clean faces.
fn hostMeshTopoLoopCut(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = scene3d.meshTopoLoopCut();
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_lc_begin(basic?) → JSON {"ok","size0","size1"}. Open a face loop-cut session on the
/// CURRENT face selection (the studio's Blockbench treatment): captures the base mesh and
/// the clicked face's two in-plane axes + spans. Previews re-cut from that base until
/// __mesh_lc_end closes the session. size0/size1 are the spans for direction 0/1.
fn hostMeshLcBegin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const basic = (argToF64(info, 0) orelse 0) != 0;
    const lc = scene3d.meshLoopCutFaceBegin(basic) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: [128]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"ok\":1,\"size0\":{d},\"size1\":{d}}}", .{ lc.size0, lc.size1 }) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, json);
}

/// __mesh_lc_preview(dir, cuts, offsetFrac) → JSON {"ok","key","count","fallbackReason"?}.
/// Install the cut at these popup params as the live mesh (the live preview — not
/// journaled). offsetFrac is 0..1 of the face's span on the chosen axis; 0.5 is the
/// even comb. fallbackReason explains a refused topological preview; no plane fallback
/// exists in the indexed Blockbench-style walk.
fn hostMeshLcPreview(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dir = argToI32(info, 0) orelse 0;
    const cuts = argToI32(info, 1) orelse 1;
    const off: f32 = @floatCast(argToF64(info, 2) orelse 0.5);
    const ok = scene3d.meshLoopCutFacePreview(@intCast(@max(0, dir)), @intCast(@max(1, cuts)), off);
    if (ok) state.markDirty();
    setMeshLcPreviewReturn(info, ok);
}

/// __mesh_lc_end(commit) → JSON {"ok","key","count"}. Apply (journal ONE 'loop cut' entry;
/// the clicked face's −side piece stays selected) or Cancel (restore the pre-cut mesh
/// exactly, no undo entry).
fn hostMeshLcEnd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const commit = (argToI32(info, 0) orelse 0) != 0;
    const ok = scene3d.meshLoopCutFaceEnd(commit);
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_lc_state() → JSON {"ok","dir","cuts","offsetFrac","key","count","fallbackReason"?}.
/// Read back the LIVE session's last-previewed params (req_2625 gap DD): a host-side
/// handle drag re-previews internally, so the popup polls this to keep its value tracking
/// the drag — key/count because every re-preview installs a NEW mesh key the cart must
/// adopt. fallbackReason mirrors the preview door for those host-owned re-previews.
fn hostMeshLcState(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const st = scene3d.meshLcState() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    const key = scene3d.meshEditActiveKey() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: [512]u8 = undefined;
    const json = if (st.fallback_reason) |reason|
        std.fmt.bufPrint(&buf, "{{\"ok\":1,\"dir\":{d},\"cuts\":{d},\"offsetFrac\":{d},\"key\":\"{s}\",\"count\":{d},\"fallbackReason\":\"{s}\"}}", .{ st.dir, st.cuts, st.offset_frac, key, scene3d.meshEditActiveCount(), reason })
    else
        std.fmt.bufPrint(&buf, "{{\"ok\":1,\"dir\":{d},\"cuts\":{d},\"offsetFrac\":{d},\"key\":\"{s}\",\"count\":{d}}}", .{ st.dir, st.cuts, st.offset_frac, key, scene3d.meshEditActiveCount() });
    setReturnString(info, json catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    });
}

/// __mesh_delete_selection() → JSON {"ok","key","count"}. Delete exactly the selected mesh
/// elements (selected faces, or faces touching a selected vert/edge) and rebuild the mesh.
fn hostMeshDeleteSelection(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = scene3d.meshDeleteSelection();
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_delete_group_range(lo, hi) → JSON {"ok","key","count"}. Delete every face in the
/// authored group range [lo, hi) — the outliner removing a whole part. Structural, so it
/// bypasses the interactive selection doors and works while the paint session owns the
/// surface (req_2981; the selection doors are inert mid-paint per req_2662).
fn hostMeshDeleteGroupRange(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    const ok = scene3d.meshDeleteGroupRange(lo, hi);
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_append_group(f32Verts, count, u32Groups, expectedParts) → JSON
/// {"ok","key","count","lo","hi"}.
/// Append a new part's triangles to the LIVE edit mesh (preserving prior edits) with a fresh
/// authored-group range. `expectedParts` is the cart's pre-append outliner count: the host
/// refuses the mutation unless its complete ownership partition agrees. Only the new part's
/// geometry crosses the bridge.
fn hostMeshAppendGroup(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const vbytes = argBytes(info, 0) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    const count = argToI32(info, 1) orelse 0;
    const gbytes = argBytes(info, 2) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    if (count <= 0 or vbytes.len % @sizeOf(f32) != 0 or gbytes.len % @sizeOf(u32) != 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const verts: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, vbytes));
    const groups: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, gbytes));
    const expected_raw = argToI32(info, 3) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    if (expected_raw < 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const expected_parts: u32 = @intCast(expected_raw);
    const r = scene3d.meshAppendGroup(verts, @intCast(count), groups, expected_parts);
    if (!r.ok) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    state.markDirty();
    const key = scene3d.meshEditActiveKey() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: [320]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"ok\":1,\"key\":\"{s}\",\"count\":{d},\"lo\":{d},\"hi\":{d}}}", .{ key, r.count, r.lo, r.hi }) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, json);
}

/// __mesh_append_path_plane(Float32Array normalizedXY, expectedParts) → append JSON.
/// Geometry stays behind the same validated part boundary as every other Add Part.
fn hostMeshAppendPathPlane(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse return setReturnString(info, "{\"ok\":0}");
    if (bytes.len % @sizeOf(f32) != 0) return setReturnString(info, "{\"ok\":0}");
    const expected_raw = argToI32(info, 1) orelse return setReturnString(info, "{\"ok\":0}");
    if (expected_raw < 0) return setReturnString(info, "{\"ok\":0}");
    const points: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, bytes));
    const result = scene3d.meshAppendPathPlane(points, @intCast(expected_raw));
    if (result.ok) state.markDirty();
    setMeshAppendReturn(info, result);
}

/// __mesh_append_path_edges(Float32Array normalizedXY, closed, expectedParts) → append JSON.
/// The Pen Edges tool: the path commits as naked wire edges (no fill face), open or
/// closed, through the same validated part boundary as every other Add Part.
fn hostMeshAppendPathEdges(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse return setReturnString(info, "{\"ok\":0}");
    if (bytes.len % @sizeOf(f32) != 0) return setReturnString(info, "{\"ok\":0}");
    const closed = (argToI32(info, 1) orelse 0) != 0;
    const expected_raw = argToI32(info, 2) orelse return setReturnString(info, "{\"ok\":0}");
    if (expected_raw < 0) return setReturnString(info, "{\"ok\":0}");
    const points: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, bytes));
    const result = scene3d.meshAppendPathWire(points, closed, @intCast(expected_raw));
    if (result.ok) state.markDirty();
    setMeshAppendReturn(info, result);
}

/// __mesh_set_group_hidden(lo, hi, hidden, journal=1) → JSON {"ok","key","count"}.
/// Hide/show the part in the group range, moving its triangles to/from a host stash
/// (non-destructive of edits). Cold hydration passes journal=0 because restoring saved
/// presentation state is not a new user edit.
fn hostMeshSetGroupHidden(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    const hidden = (argToI32(info, 2) orelse 0) != 0;
    const journal = (argToI32(info, 3) orelse 1) != 0;
    const ok = scene3d.meshSetGroupHidden(lo, hi, hidden, journal);
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_group_face_count(lo, hi) → surviving faces in the group range. The outliner asks
/// this after a delete to drop parts whose geometry is entirely gone.
fn hostMeshGroupFaceCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    setReturnNumber(info, scene3d.meshGroupFaceCount(lo, hi));
}

/// __mesh_surviving_groups(lo, hi) → "g0,g1,…" of the authored groups in the range that still
/// have a face after a delete. The outliner prunes each part's stored faces to these.
fn hostMeshSurvivingGroups(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    var ids: [4096]u32 = undefined;
    const n = scene3d.meshSurvivingGroups(lo, hi, ids[0..]);
    var buf: [40960]u8 = undefined;
    var pos: usize = 0;
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        if (i > 0 and pos < buf.len) {
            buf[pos] = ',';
            pos += 1;
        }
        const s = std.fmt.bufPrint(buf[pos..], "{d}", .{ids[i]}) catch break;
        pos += s.len;
    }
    setReturnString(info, buf[0..pos]);
}

fn setMeshAppendReturn(info: v8.FunctionCallbackInfo, r: anytype) void {
    if (!r.ok) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const key = scene3d.meshEditActiveKey() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: [320]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"ok\":1,\"key\":\"{s}\",\"count\":{d},\"lo\":{d},\"hi\":{d}}}", .{ key, r.count, r.lo, r.hi }) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, json);
}

/// __mesh_undo() / __mesh_redo() → JSON {"ok","key","count","label","undo","redo"}.
/// Swap the live edit mesh with the top journal snapshot (full pre-op state: verts,
/// groups, part ranges, colours, hidden stash, and the cart's parts-metadata note —
/// read the restored note back with __mesh_journal_note()).
fn hostMeshUndoRedo(info: v8.FunctionCallbackInfo, redo: bool) void {
    const label = if (redo) scene3d.meshRedoLabel() else scene3d.meshUndoLabel();
    const ok = if (redo) scene3d.meshRedo() else scene3d.meshUndo();
    if (!ok) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    state.markDirty();
    const key = scene3d.meshEditActiveKey() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    const depths = scene3d.meshJournalCounts();
    var buf: [420]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"ok\":1,\"key\":\"{s}\",\"count\":{d},\"label\":\"{s}\",\"undo\":{d},\"redo\":{d}}}", .{ key, scene3d.meshEditActiveCount(), label, depths[0], depths[1] }) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, json);
}
fn hostMeshUndo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hostMeshUndoRedo(v8.FunctionCallbackInfo.initFromV8(info_c), false);
}
fn hostMeshRedo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hostMeshUndoRedo(v8.FunctionCallbackInfo.initFromV8(info_c), true);
}

/// __mesh_history() → JSON {"undo":n,"redo":n,"undoLabel","redoLabel"} —
/// cheap journal state for menu enablement and the UV panel's scoped controls.
fn hostMeshHistory(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const depths = scene3d.meshJournalCounts();
    var buf: [256]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"undo\":{d},\"redo\":{d},\"undoLabel\":\"{s}\",\"redoLabel\":\"{s}\"}}", .{
        depths[0],
        depths[1],
        scene3d.meshUndoLabel(),
        scene3d.meshRedoLabel(),
    }) catch "{\"undo\":0,\"redo\":0,\"undoLabel\":\"\",\"redoLabel\":\"\"}";
    setReturnString(info, json);
}

/// __mesh_history_log() → complete bounded journal JSON. This is intentionally
/// read-only: the model context menu uses it to inspect operation chronology,
/// topology counts, and exact face ownership without perturbing the journal.
fn hostMeshHistoryLog(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const allocator = std.heap.c_allocator;
    if (scene3d.meshJournalLogJson(allocator)) |json| {
        defer allocator.free(json);
        setReturnString(info, json);
    } else setReturnString(info, "");
}

const MESH_ACTION_WORDS: usize = 10;
var mesh_action_buf: [scene3d.MESH_ACTION_CAP]scene3d.MeshActionEvent = undefined;
var mesh_action_out: [1 + scene3d.MESH_ACTION_CAP * MESH_ACTION_WORDS]u32 = undefined;

/// __mesh_action_source(sourceOrdinal) — scope the next synchronous JS-invoked
/// mesh mutation. Engine-owned gestures remain `native` without crossing JS.
fn hostMeshActionSource(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 9));
    scene3d.meshActionSourceSet(raw);
}

/// __mesh_action_document(token) — stable cart-supplied document token stamped
/// into queued outcomes so a fast tab switch cannot retarget an older action.
fn hostMeshActionDocument(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const token: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    scene3d.meshActionDocumentSet(token);
}

/// __mesh_action_drain() → Uint32 ArrayBuffer. One fixed row per accepted
/// journal commit/control: id, document, kind, phase, source, before/after
/// vertex counts, before/after part counts, and prior queue overflow.
fn hostMeshActionDrain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const n = scene3d.meshActionDrain(mesh_action_buf[0..]);
    mesh_action_out[0] = @intCast(n);
    for (mesh_action_buf[0..n], 0..) |event, i| {
        const base = 1 + i * MESH_ACTION_WORDS;
        mesh_action_out[base + 0] = event.id;
        mesh_action_out[base + 1] = event.document_token;
        mesh_action_out[base + 2] = @intFromEnum(event.kind);
        mesh_action_out[base + 3] = @intFromEnum(event.phase);
        mesh_action_out[base + 4] = @intFromEnum(event.source);
        mesh_action_out[base + 5] = event.before_vertices;
        mesh_action_out[base + 6] = event.after_vertices;
        mesh_action_out[base + 7] = event.before_parts;
        mesh_action_out[base + 8] = event.after_parts;
        mesh_action_out[base + 9] = event.dropped_before;
    }
    setReturnU32Buffer(info, mesh_action_out[0 .. 1 + n * MESH_ACTION_WORDS]);
}

/// __mesh_journal_note(json?) — with an argument: SET the cart's opaque parts-metadata
/// note (rides every subsequent journal snapshot). Without: GET the current note (the
/// one an undo/redo just restored) — "" when none. The note lets the outliner resync
/// its part rows after a restore without geometry crossing the bridge.
fn hostMeshJournalNote(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToStringAlloc(info, 0)) |note| {
        defer std.heap.c_allocator.free(note);
        setReturnNumber(info, if (scene3d.meshJournalNoteSet(note)) 1 else 0);
        return;
    }
    const note = scene3d.meshJournalNoteGet() orelse {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, note);
}

/// __mesh_journal_checkpoint(kind, beforeNote, afterNote) → 1/0. Metadata-only
/// model edits become native journal units without fabricating a geometry op.
fn hostMeshJournalCheckpoint(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const kind = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(kind);
    const before = argToStringAlloc(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(before);
    const after = argToStringAlloc(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(after);

    const label = scene3d.meshJournalMetadataCheckpointLabel(kind) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const ok = scene3d.meshJournalMetadataCheckpoint(label, before, after);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __mesh_duplicate_range(lo, hi, mirrorAxis) → JSON {"ok","key","count","lo","hi"}.
/// Duplicate the part in the group range as a NEW part — mirrorAxis 0/1/2 reflects the
/// copy across that origin plane (winding fixed); -1 is a plain copy. Paint carries.
fn hostMeshDuplicateRange(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    const mirror: i32 = argToI32(info, 2) orelse -1;
    const r = scene3d.meshDuplicateGroupRange(lo, hi, mirror);
    if (r.ok) state.markDirty();
    setMeshAppendReturn(info, r);
}

/// __mesh_path_array(u32Ranges, axis, bays, turnDegrees, rise, profile)
///   → JSON {"ok","key","count","ranges":[[lo,hi],...]}
/// Keep the selected source bay untouched, then append bays-1 independently editable
/// copies along one constant-radius horizontal turn and elevation profile. The selected
/// ranges are read from the resident edited mesh; the full append is one journal unit.
fn setMeshPathArrayReturn(info: v8.FunctionCallbackInfo, result: scene3d.PathArrayResult) void {
    const fresh = result.ranges orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    defer std.heap.c_allocator.free(fresh);
    if (!result.ok) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const key = scene3d.meshEditActiveKey() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var json: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer json.deinit();
    const w = &json.writer;
    w.print("{{\"ok\":1,\"key\":\"{s}\",\"count\":{d},\"ranges\":[", .{ key, result.count }) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var i: usize = 0;
    while (i + 1 < fresh.len) : (i += 2) {
        w.print("{s}[{d},{d}]", .{ if (i == 0) "" else ",", fresh[i], fresh[i + 1] }) catch {
            setReturnString(info, "{\"ok\":0}");
            return;
        };
    }
    w.writeAll("]}") catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    state.markDirty();
    setReturnString(info, json.written());
}

fn hostMeshPathArray(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const range_bytes = argBytes(info, 0) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    if (range_bytes.len == 0 or range_bytes.len % (2 * @sizeOf(u32)) != 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const ranges: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, range_bytes));
    const axis_code: u8 = @intCast(std.math.clamp(argToI32(info, 1) orelse 0, 0, 3));
    const bays: u32 = @intCast(@max(0, argToI32(info, 2) orelse 0));
    const turn_degrees: f32 = @floatCast(argToF64(info, 3) orelse 0);
    const rise: f32 = @floatCast(argToF64(info, 4) orelse 0);
    const profile_code: u8 = @intCast(std.math.clamp(argToI32(info, 5) orelse 0, 0, 1));
    const params = scene3d.PathArrayParams{
        .axis = @enumFromInt(axis_code),
        .bays = bays,
        .turn_radians = turn_degrees * (@as(f32, std.math.pi) / 180),
        .rise = rise,
        .profile = @enumFromInt(profile_code),
    };
    setMeshPathArrayReturn(info, scene3d.meshPathArray(std.heap.c_allocator, ranges, params));
}

/// __mesh_path_array_points(u32Ranges, axis, f32PointTriples) → path-array JSON.
/// Points are model-space XYZ offsets from the source bay's forward-end center;
/// point zero is the fixed origin and every adjacent pair defines one generated bay.
fn hostMeshPathArrayPoints(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const range_bytes = argBytes(info, 0) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    const point_bytes = argBytes(info, 2) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    if (range_bytes.len == 0 or range_bytes.len % (2 * @sizeOf(u32)) != 0 or point_bytes.len < 2 * 3 * @sizeOf(f32) or point_bytes.len % (3 * @sizeOf(f32)) != 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const ranges: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, range_bytes));
    const points: []const [3]f32 = @alignCast(std.mem.bytesAsSlice([3]f32, point_bytes));
    const axis_code: u8 = @intCast(std.math.clamp(argToI32(info, 1) orelse 0, 0, 3));
    setMeshPathArrayReturn(info, scene3d.meshPathArrayPoints(std.heap.c_allocator, ranges, @enumFromInt(axis_code), points));
}

/// __mesh_path_array_spans(u32Ranges) → JSON {"ok":1,"x":modelUnits,"z":modelUnits}.
/// Read-only sizing hint for the coordinate editor; no journal or dirty state.
fn hostMeshPathArraySpans(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const range_bytes = argBytes(info, 0) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    if (range_bytes.len == 0 or range_bytes.len % (2 * @sizeOf(u32)) != 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const ranges: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, range_bytes));
    const spans = scene3d.meshPathArrayHorizontalSpans(ranges) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: [128]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"ok\":1,\"x\":{d},\"z\":{d}}}", .{ spans[0], spans[1] }) catch "{\"ok\":0}";
    setReturnString(info, json);
}

/// __mesh_topo_detach() → JSON {"ok","key","count","lo","hi"}. Peel the selected faces
/// (face mode) into a NEW part — a pure authored-group remap; geometry and paint stay.
fn hostMeshTopoDetach(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const r = scene3d.meshDetachSelection();
    if (r.ok) state.markDirty();
    setMeshAppendReturn(info, r);
}

/// __mesh_merge_parts(aLo, aHi, bLo, bHi) → JSON {"ok","key","count","lo","hi"}. Merge
/// two parts' faces into ONE fresh group range (the old studio's "merge down").
fn hostMeshMergeParts(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a_lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const a_hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    const b_lo: u32 = @intCast(@max(0, argToI32(info, 2) orelse 0));
    const b_hi: u32 = @intCast(@max(0, argToI32(info, 3) orelse 0));
    const r = scene3d.meshMergeGroupRanges(a_lo, a_hi, b_lo, b_hi);
    if (r.ok) state.markDirty();
    setMeshAppendReturn(info, r);
}

/// __mesh_topo_merge_faces() → JSON {"ok","key","count"}. Fuse the selected faces
/// (2+ authored groups, face mode) into one authored face (shared group id).
fn hostMeshTopoMergeFaces(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = scene3d.meshMergeSelectedFaces();
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_topo_glass() → JSON {"ok","key","count"}. Toggle the selected faces as GLASS
/// (translucent alpha, drawn through the transparent pass). Re-toggling un-glasses.
fn hostMeshTopoGlass(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = scene3d.meshSetSelectionGlass();
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __model_glass_restore(glassFirstVertex) → 1|0. Re-apply the saved glass run
/// after a mount (doc.blob header v2+ carries the boundary; the paint program/
/// baseline are RGB-only by design, req_2928/req_3402). A load, never an edit —
/// nothing journals, the model does not go dirty.
fn hostModelGlassRestore(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const gv: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const ok = scene3d.meshRestoreGlass(gv);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __mesh_topo_solidify(thickness) → JSON {"ok","key","count"}. Give the selected faces
/// thickness in place (inner skin + rim walls). thickness <= 0 uses 0.125 m (2/16).
fn hostMeshTopoSolidify(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const thickness: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const ok = scene3d.meshSolidifySelection(thickness);
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_append_file(path, expectedParts) → JSON {"ok","key","count","lo","hi"}. Parse a .glb/.obj in
/// the host and APPEND it to the live edit mesh as a new part (per-triangle groups) —
/// cross-model reuse without the file's geometry ever crossing the bridge.
fn hostMeshAppendFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    defer std.heap.c_allocator.free(path);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    var mesh = mesh_import.loadFile(io, std.heap.c_allocator, path) catch |e| {
        std.log.warn("[mesh-append] {s}: {}", .{ path, e });
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    defer mesh.deinit(std.heap.c_allocator);
    const expected_raw = argToI32(info, 1) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    if (expected_raw < 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const tris = mesh.vert_count / 3;
    if (tris == 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    const groups = std.heap.c_allocator.alloc(u32, tris) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    defer std.heap.c_allocator.free(groups);
    for (groups, 0..) |*g, i| g.* = @intCast(i);
    const r = scene3d.meshAppendGroup(mesh.verts[0 .. @as(usize, mesh.vert_count) * 8], mesh.vert_count, groups, @intCast(expected_raw));
    if (r.ok) state.markDirty();
    setMeshAppendReturn(info, r);
}

/// __mesh_edit_snapshot() — save the selection before an instant mousedown pick.
fn hostMeshEditSnapshot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    scene3d.meshEditSnapshot();
}

/// __mesh_edit_revert() — restore the snapshot (the press became an orbit-drag). Repaints.
fn hostMeshEditRevert(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    scene3d.meshEditRevert();
    state.markDirty();
}

/// __mesh_edit_select_group_range(lo, hi, additive) → selected face count. Select (face
/// mode) every face whose authored group id is in [lo, hi) — the outliner grabs a whole part.
fn hostMeshEditSelectGroupRange(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    const additive = (argToI32(info, 2) orelse 0) != 0;
    const n = scene3d.meshEditSelectGroupRange(lo, hi, additive);
    state.markDirty();
    setReturnNumber(info, n);
}

/// __mesh_edit_scope(lo, hi). Restrict editing to the group range [lo, hi) — the outliner
/// focusing one part. hi <= lo edits the whole model.
fn hostMeshEditScope(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    scene3d.meshEditSetScope(lo, hi);
    state.markDirty();
}

/// __mesh_edit_scope_ranges(u32Pairs) → 1|0. Restrict editing to the UNION of group
/// ranges — flattened [lo,hi) pairs (Uint32Array), the outliner's shift-accumulated
/// multi-select (req_2659). Empty/absent clears the scope (whole model).
fn hostMeshEditScopeRanges(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        scene3d.meshEditSetScopeRanges(&.{});
        state.markDirty();
        setReturnNumber(info, 1);
        return;
    };
    if (bytes.len % (2 * @sizeOf(u32)) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const pairs: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, bytes));
    scene3d.meshEditSetScopeRanges(pairs);
    state.markDirty();
    setReturnNumber(info, 1);
}

/// __mesh_paint_session(on) — the cart's paint mode, mirrored to the host so the mode
/// row stays ONE exclusive state machine (req_2662): while on, selection doors are
/// inert and the edit overlay (face wash/dots/edges/gizmo) goes quiet. Turning it on
/// resets the selection (paint entry clears; leaving paint starts clean).
fn hostMeshPaintSession(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const on = (argToI32(info, 0) orelse 0) != 0;
    const host = v8_runtime.hostContext(info.getIsolate());
    scene3d.setPaintSession(host.io, host.environ, on);
    state.markDirty();
}

/// __model_paint_layout_stale() → 1 when structural geometry changed after the
/// last explicit atlas build. Brush/fill doors are host-blocked in this state.
fn hostModelPaintLayoutStale(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (scene3d.paintLayoutStale()) 1 else 0);
}

/// __model_paint_layout_invalidate() → restore a persisted stale-layout marker
/// after the mesh document is adopted on a cold load.
fn hostModelPaintLayoutInvalidate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    scene3d.invalidatePaintLayout();
    setReturnNumber(info, 1);
}

// ── Stroke journal + paint layers (req_2672) ─────────────────────────────────────────

/// __mesh_paint_stroke_end() → 1 when an open stroke committed as one undo unit, else 0.
/// The cart calls this on pointer-up/leave; a unit auto-opens on the first recorded dab.
fn hostMeshPaintStrokeEnd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    setReturnNumber(info, if (scene3d.paintStrokeEnd(host.io, host.environ)) 1 else 0);
}

/// __mesh_paint_undo() / __mesh_paint_redo() → JSON {"ok","label","undo","redo"} (the
/// __mesh_undo style). Drops/re-appends one stroke-journal unit and RE-RUNS the stroke
/// program onto the atlas — geometry never changes, so no mesh key rides the answer.
fn hostMeshPaintUndoRedo(info: v8.FunctionCallbackInfo, redo: bool) void {
    const host = v8_runtime.hostContext(info.getIsolate());
    const label = if (redo) scene3d.paintRedoLabel() else scene3d.paintUndoLabel();
    const ok = if (redo)
        scene3d.paintStrokeRedo(host.io, host.environ)
    else
        scene3d.paintStrokeUndo(host.io, host.environ);
    if (!ok) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    state.markDirty();
    const depths = scene3d.paintHistoryCounts();
    var buf: [192]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"ok\":1,\"label\":\"{s}\",\"undo\":{d},\"redo\":{d}}}", .{ label, depths[0], depths[1] }) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, json);
}
fn hostMeshPaintUndo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hostMeshPaintUndoRedo(v8.FunctionCallbackInfo.initFromV8(info_c), false);
}
fn hostMeshPaintRedo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hostMeshPaintUndoRedo(v8.FunctionCallbackInfo.initFromV8(info_c), true);
}

/// __mesh_paint_history() → JSON {"undo","redo","live","label","redoLabel"} — the stroke
/// journal's depths + top labels, and whether the paint SESSION is live (the cart's
/// undo routing + dock badge read this while painting).
fn hostMeshPaintHistory(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const depths = scene3d.paintHistoryCounts();
    var buf: [256]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"undo\":{d},\"redo\":{d},\"live\":{d},\"label\":\"{s}\",\"redoLabel\":\"{s}\"}}", .{
        depths[0],
        depths[1],
        @as(u8, if (scene3d.paintSessionActive()) 1 else 0),
        scene3d.paintUndoLabel(),
        scene3d.paintRedoLabel(),
    }) catch "{\"undo\":0,\"redo\":0,\"live\":0,\"label\":\"\",\"redoLabel\":\"\"}";
    setReturnString(info, json);
}

fn appendJsonEscaped(w: *std.Io.Writer, s: []const u8) !void {
    for (s) |ch| {
        switch (ch) {
            '"' => try w.writeAll("\\\""),
            '\\' => try w.writeAll("\\\\"),
            else => {
                if (ch < 0x20) continue; // control chars have no place in a layer name
                try w.writeByte(ch);
            },
        }
    }
}

// The one layer-list serializer: {"ok":1,"active":id,"layers":[{...bottom→top...}]}.
fn writePaintLayersJson(info: v8.FunctionCallbackInfo) void {
    const alloc_ = std.heap.c_allocator;
    if (scene3d.paintLayerCount() == 0) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    var out: std.Io.Writer.Allocating = .init(alloc_);
    defer out.deinit();
    const build = struct {
        fn run(o: *std.Io.Writer.Allocating) !void {
            const w = &o.writer;
            try w.print("{{\"ok\":1,\"active\":{d},\"layers\":[", .{scene3d.paintActiveLayer()});
            var i: usize = 0;
            while (i < scene3d.paintLayerCount()) : (i += 1) {
                const l = scene3d.paintLayerAt(i);
                try w.print("{s}{{\"id\":{d},\"name\":\"", .{ if (i == 0) "" else ",", l.id });
                try appendJsonEscaped(w, l.name);
                try w.print("\",\"visible\":{d},\"strokes\":{d}}}", .{ @as(u8, if (l.visible) 1 else 0), l.strokes });
            }
            try w.writeAll("]}");
        }
    };
    build.run(&out) catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, out.written());
}

/// __mesh_paint_layers() → the layer list JSON above, or {"ok":0} before any painting.
fn hostMeshPaintLayers(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    writePaintLayersJson(v8.FunctionCallbackInfo.initFromV8(info_c));
}

/// __mesh_paint_layer_op(op, id, arg) → the refreshed layer list JSON ({"ok":0} on a
/// refused op). Ops: "add" (id/arg unused) · "delete" id · "up"/"down" id (reorder one
/// step) · "visible" id arg(0|1) · "active" id · "rename" id arg(name) · "mergedown" id.
/// Structural ops journal as stroke-journal units; visibility/order/delete/merge re-run
/// the program (visibility off = skip that layer's strokes — the ruling's replay law).
fn hostMeshPaintLayerOp(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const op = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    defer std.heap.c_allocator.free(op);
    const id: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    var ok = false;
    if (std.mem.eql(u8, op, "add")) {
        ok = scene3d.paintLayerAdd() != 0;
    } else if (std.mem.eql(u8, op, "delete")) {
        ok = scene3d.paintLayerDelete(host.io, host.environ, id);
    } else if (std.mem.eql(u8, op, "up")) {
        ok = scene3d.paintLayerMove(host.io, host.environ, id, true);
    } else if (std.mem.eql(u8, op, "down")) {
        ok = scene3d.paintLayerMove(host.io, host.environ, id, false);
    } else if (std.mem.eql(u8, op, "visible")) {
        ok = scene3d.paintLayerSetVisible(host.io, host.environ, id, (argToI32(info, 2) orelse 0) != 0);
    } else if (std.mem.eql(u8, op, "active")) {
        ok = scene3d.paintLayerSetActive(id);
    } else if (std.mem.eql(u8, op, "rename")) {
        if (argToStringAlloc(info, 2)) |name| {
            defer std.heap.c_allocator.free(name);
            ok = scene3d.paintLayerRename(id, name);
        }
    } else if (std.mem.eql(u8, op, "mergedown")) {
        ok = scene3d.paintLayerMergeDown(host.io, host.environ, id);
    }
    if (!ok) {
        setReturnString(info, "{\"ok\":0}");
        return;
    }
    state.markDirty();
    writePaintLayersJson(info);
}

/// __mesh_set_part_ranges(u32Pairs) → 1|0. Adopt the outliner's PART ranges — flattened
/// [lo,hi) authored-group pairs, sorted, non-overlapping. The weld keys on (position, part)
/// so coincident verts in different parts never merge and edits can't bleed across stacked
/// parts. Empty array clears (position-only weld). Sent after every load/append.
fn hostMeshSetPartRanges(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        scene3d.meshEditSetPartRanges(&.{});
        setReturnNumber(info, 1);
        return;
    };
    if (bytes.len % (2 * @sizeOf(u32)) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const pairs: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, bytes));
    scene3d.meshEditSetPartRanges(pairs);
    state.markDirty();
    setReturnNumber(info, 1);
}

/// __mesh_part_ranges() → JSON {"ok":1,"ranges":[[lo,hi],...]} — the HOST's authoritative
/// per-part authored-group ranges, in ascending-lo (outliner) order. This is the ONE
/// read-back the cart mirrors after every topology op / undo / redo (req_2644): the host
/// maintains the ranges through ops that re-number groups (loop cut, extrude, detach,
/// merge, append), so cart-side lo/hi are never patched incrementally again.
/// {"ok":0} when the mesh carries no part ranges (plain imports, unparted viewers).
fn hostMeshPartRanges(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const pr = model_source.partRanges() orelse {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var buf: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer buf.deinit();
    const w = &buf.writer;
    w.writeAll("{\"ok\":1,\"ranges\":[") catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    var i: usize = 0;
    while (i + 1 < pr.len) : (i += 2) {
        w.print("{s}[{d},{d}]", .{ if (i == 0) "" else ",", pr[i], pr[i + 1] }) catch {
            setReturnString(info, "{\"ok\":0}");
            return;
        };
    }
    w.writeAll("]}") catch {
        setReturnString(info, "{\"ok\":0}");
        return;
    };
    setReturnString(info, buf.written());
}

/// __model_paint_group_range(lo, hi, r, g, b) → face count. Paint every face in the group
/// range a solid colour — the outliner tints each part its own colour on load.
fn hostModelPaintGroupRange(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const lo: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const hi: u32 = @intCast(@max(0, argToI32(info, 1) orelse 0));
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 0, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 0, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 4) orelse 0, 0, 255));
    const n = scene3d.meshPaintGroupRange(lo, hi, r, g, b);
    state.markDirty();
    setReturnNumber(info, n);
}

/// __mesh_edit_select_face(idx, additive) → bool. Select a face by index (no raycast) —
/// programmatic selection (select-all / scripting) and the headless highlight proof.
fn hostMeshEditSelectFace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const idx: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const additive = (argToI32(info, 1) orelse 0) != 0;
    const ok = scene3d.meshEditSelectFace(idx, additive);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __mesh_edit_select_uv_orientation() → authored-face count. Starting from
/// the current face selection, collect every UV island projected from the same
/// direction (±X/±Y/±Z) so fragmented atlas pieces become one rigid selection.
fn hostMeshEditSelectUvOrientation(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const count = scene3d.meshEditSelectUvOrientation();
    if (count > 0) state.markDirty();
    setReturnNumber(info, count);
}

/// __mesh_edit_select_edge(idx, additive) → bool. Programmatic welded-edge select for
/// topology tools and headless verification.
fn hostMeshEditSelectEdge(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const idx: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const additive = (argToI32(info, 1) orelse 0) != 0;
    const ok = scene3d.meshEditSelectEdge(idx, additive);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __mesh_edit_guard() → JSON {"pending","bad","faces","canSplit"}. A pending guard
/// means a gizmo edit collapsed or flipped triangles and needs user confirmation.
fn hostMeshEditGuard(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const g = scene3d.meshEditGuardInfo();
    var buf: [128]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"pending\":{d},\"bad\":{d},\"faces\":{d},\"canSplit\":{d}}}", .{ g[0], g[1], g[2], g[3] }) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, json);
}

/// __mesh_edit_guard_resolve(action) → bool. action: 0 split/keep triangulated,
/// 1 ignore/accept, 2 revert to the pre-drag snapshot.
fn hostMeshEditGuardResolve(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const action: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 1, 0, 2));
    const changed = scene3d.meshEditGuardResolve(action);
    state.markDirty();
    setReturnNumber(info, if (changed) 1 else 0);
}

/// __mesh_symmetry_report(axis) → JSON {"center","unmatched","total"} — the live
/// symmetry badge (studio req_1191/1192 ported, req_2831). "" when no mesh is resident.
fn hostMeshSymmetryReport(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const axis: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 2));
    const rep = scene3d.meshSymmetryReport(axis) orelse {
        setReturnString(info, "");
        return;
    };
    var buf: [96]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"center\":{d:.4},\"unmatched\":{d},\"total\":{d}}}", .{ rep[0], @as(u32, @trunc(rep[1])), @as(u32, @trunc(rep[2])) }) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, json);
}

/// __mesh_symmetrize(axis, keepPositive) → JSON {"ok","key","count"} — the keep+/keep−
/// repair (studio req_1190 ported, req_2831): the model comes out exactly symmetric
/// across the plane; the fresh mesh key rides the standard topo return for adoptMesh.
fn hostMeshSymmetrize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const axis: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 2));
    const keep = (argToI32(info, 1) orelse 1) != 0;
    const ok = scene3d.meshTopoSymmetrize(axis, keep);
    if (ok) state.markDirty();
    setMeshTopoReturn(info, ok);
}

/// __mesh_edit_counts() → JSON {"mode","verts","edges","sel"} for the HUD.
fn hostMeshEditCounts(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cn = scene3d.meshEditCounts();
    var buf: [128]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"mode\":{d},\"verts\":{d},\"edges\":{d},\"sel\":{d}}}", .{ cn[0], cn[1], cn[2], cn[3] }) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, json);
}

/// __model_paint_at(x, y, r, g, b) → bool. Raycast the viewport pixel (x,y) against the
/// resident model and fill the LOGICAL face it hits (the whole authored group — a quad,
/// not one triangle; req_2506) with (r,g,b). One call covers both gestures: a click fills
/// one face, a drag fires this per move. Returns 1 on a hit (and repaints), 0 on a miss.
/// r/g/b are 0–255. scene3d.paintAt owns the per-member atlas + source-store writes.
fn hostModelPaintAt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 0, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 0, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 4) orelse 0, 0, 255));
    const face = scene3d.paintAt(x, y, r, g, b);
    if (face >= 0) state.markDirty();
    setReturnNumber(info, if (face >= 0) 1 else 0);
}

/// __model_paint_face(face, r, g, b) → bool. Fill a face by index (no raycast) —
/// __image_write_png(path, base64Rgba, w, h) → 1 on success. Writes RGBA pixels
/// (base64, w*h*4 bytes) straight to a PNG on disk. The model-package writer uses
/// it to persist a painted atlas as a real, copy-anywhere image (req_2523).
fn hostImageWritePng(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.c_allocator;
    const path = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(path);
    const b64 = argToStringAlloc(info, 1) orelse return setReturnNumber(info, 0);
    defer alloc.free(b64);
    const w: u32 = @intCast(@max(0, argToI32(info, 2) orelse 0));
    const h: u32 = @intCast(@max(0, argToI32(info, 3) orelse 0));
    if (w == 0 or h == 0) return setReturnNumber(info, 0);

    const dec = std.base64.standard.Decoder;
    const dlen = dec.calcSizeForSlice(b64) catch return setReturnNumber(info, 0);
    const rgba = alloc.alloc(u8, dlen) catch return setReturnNumber(info, 0);
    defer alloc.free(rgba);
    dec.decode(rgba, b64) catch return setReturnNumber(info, 0);

    setReturnNumber(info, if (capture.writeRgbaPng(io, path, rgba, w, h)) 1 else 0);
}

/// __model_mesh_write(path) → 1 on success. Writes the active model's durable mesh
/// (interleaved 8 f32/vert, raw little-endian) to `path`, so a model's package folder
/// carries its own geometry instead of an empty dir. A live quality projection is the
/// durable mesh by user choice (req_3315). vert count = filesize / 32.
fn hostModelMeshWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.c_allocator;
    const path = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(path);
    var document = scene3d.modelDocumentSnapshot(alloc) orelse return setReturnNumber(info, 0);
    defer document.deinit(alloc);
    const verts = document.verts;
    if (verts.len == 0) return setReturnNumber(info, 0);
    const pathz = alloc.dupeZ(u8, path) catch return setReturnNumber(info, 0);
    defer alloc.free(pathz);
    const file = std.Io.Dir.cwd().createFile(io, pathz, .{ .truncate = true }) catch return setReturnNumber(info, 0);
    defer file.close(io);
    file.writeStreamingAll(io, std.mem.sliceAsBytes(verts)) catch return setReturnNumber(info, 0);
    setReturnNumber(info, 1);
}

/// __model_painted_mesh_write(path) → 1 on success. Writes the active model's DISPLAYED
/// mesh (interleaved 8 f32/vert, raw little-endian) — the verts whose UVs the paint
/// island layout rewrote into atlas space, i.e. the ONLY vertex set atlases/base.png
/// maps onto (req_2833: pairing the atlas with source-UV verts scrambles the painting).
/// Written beside base.blob as mesh/painted.blob so a placement consumer can render
/// the painted model exactly as the editor shows it.
fn hostModelPaintedMeshWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.c_allocator;
    const path = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(path);
    var document = scene3d.paintedDocumentSnapshot(alloc) orelse return setReturnNumber(info, 0);
    defer document.deinit(alloc);
    const verts = document.verts;
    if (verts.len == 0) return setReturnNumber(info, 0);
    const pathz = alloc.dupeZ(u8, path) catch return setReturnNumber(info, 0);
    defer alloc.free(pathz);
    const file = std.Io.Dir.cwd().createFile(io, pathz, .{ .truncate = true }) catch return setReturnNumber(info, 0);
    defer file.close(io);
    file.writeStreamingAll(io, std.mem.sliceAsBytes(verts)) catch return setReturnNumber(info, 0);
    setReturnNumber(info, 1);
}

/// __model_meshdoc_write(path, expectedRangeCount?) → 1 on success. The model DOCUMENT blob (RJMD v3) — the
/// full editable state of the resident model, so a saved package reopens as the same
/// multi-part document instead of re-arming its primitive seed (req_2753). Layout:
/// header u32×8 [magic 'RJMD', version=3, vertCount, faceCount, hasGroups, rangeCount,
/// glassFirstVertex, hasMaterials],
/// then vertCount×8 f32 durable verts, then faceCount u32 authored-face-group ids (when
/// hasGroups=1), faceCount u32 texture-role indices (when hasMaterials=1), then
/// rangeCount×2 u32 flattened [lo,hi) per-part group ranges. All
/// little-endian, no padding. The editor's meshDoc.ts reader is the format's twin.
fn hostModelMeshdocWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.c_allocator;
    const path = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(path);
    var document = scene3d.modelDocumentSnapshot(alloc) orelse return setReturnNumber(info, 0);
    defer document.deinit(alloc);
    const verts = document.verts;
    if (verts.len < 8) return setReturnNumber(info, 0);
    const vert_count: u32 = @intCast(verts.len / 8);
    const face_count: u32 = vert_count / 3;
    const groups: ?[]const u32 = if (document.groups) |rows| rows else null;
    const materials: ?[]const u32 = if (document.materials) |rows| rows else null;
    const ranges = model_source.partRanges();
    const has_groups: u32 = if (groups != null and groups.?.len == face_count) 1 else 0;
    var has_materials: u32 = 0;
    if (materials) |rows| {
        if (rows.len == face_count) {
            for (rows) |material| if (material != model_source.NO_FACE_MATERIAL) {
                has_materials = 1;
                break;
            };
        }
    }
    const range_count: u32 = if (ranges) |r| @intCast(r.len / 2) else 0;
    if (!meshdoc_format.rangesValid(ranges, range_count)) return setReturnNumber(info, 0);
    if (!meshdoc_format.rangesOwnEveryFace(ranges, groups, range_count)) {
        std.log.err("[meshdoc] refused write: at least one Outliner range has no resident visible/hidden faces, or a face has no range owner", .{});
        return setReturnNumber(info, 0);
    }
    if (argToI32(info, 1)) |expected| {
        if (expected < 0 or @as(u32, @intCast(expected)) != range_count) return setReturnNumber(info, 0);
    }

    // Never truncate the durable document in place. A complete, fsynced temp file is
    // atomically renamed over it only after every section succeeds (req_3234).
    var tmp_buf: [std.fs.max_path_bytes]u8 = undefined;
    const tmp_path = std.fmt.bufPrint(&tmp_buf, "{s}.tmp.{d}", .{ path, std.Io.Clock.now(.real, io).toNanoseconds() }) catch return setReturnNumber(info, 0);
    const file = std.Io.Dir.cwd().createFile(io, tmp_path, .{ .truncate = true }) catch return setReturnNumber(info, 0);
    const glass_first_vertex = @min(document.glass_first_vertex, vert_count);
    const header = [8]u32{ 0x444D4A52, 3, vert_count, face_count, has_groups, range_count, glass_first_vertex, has_materials };
    file.writeStreamingAll(io, std.mem.sliceAsBytes(header[0..])) catch {
        file.close(io);
        std.Io.Dir.cwd().deleteFile(io, tmp_path) catch {};
        return setReturnNumber(info, 0);
    };
    file.writeStreamingAll(io, std.mem.sliceAsBytes(verts[0 .. @as(usize, vert_count) * 8])) catch {
        file.close(io);
        std.Io.Dir.cwd().deleteFile(io, tmp_path) catch {};
        return setReturnNumber(info, 0);
    };
    if (has_groups == 1) {
        file.writeStreamingAll(io, std.mem.sliceAsBytes(groups.?[0..face_count])) catch {
            file.close(io);
            std.Io.Dir.cwd().deleteFile(io, tmp_path) catch {};
            return setReturnNumber(info, 0);
        };
    }
    if (has_materials == 1) {
        file.writeStreamingAll(io, std.mem.sliceAsBytes(materials.?[0..face_count])) catch {
            file.close(io);
            std.Io.Dir.cwd().deleteFile(io, tmp_path) catch {};
            return setReturnNumber(info, 0);
        };
    }
    if (range_count > 0) {
        file.writeStreamingAll(io, std.mem.sliceAsBytes(ranges.?)) catch {
            file.close(io);
            std.Io.Dir.cwd().deleteFile(io, tmp_path) catch {};
            return setReturnNumber(info, 0);
        };
    }
    file.sync(io) catch {
        file.close(io);
        std.Io.Dir.cwd().deleteFile(io, tmp_path) catch {};
        return setReturnNumber(info, 0);
    };
    file.close(io);
    std.Io.Dir.rename(std.Io.Dir.cwd(), tmp_path, std.Io.Dir.cwd(), path, io) catch {
        std.Io.Dir.cwd().deleteFile(io, tmp_path) catch {};
        return setReturnNumber(info, 0);
    };
    setReturnNumber(info, 1);
}

/// __model_atlas_base(mode, r, g, b) → 1. Set the atlas base TYPE — 0 Texture Template,
/// 1 Solid Colour, 2 Blank — and re-lay it on the current unpainted atlas (req_2546).
fn hostModelAtlasBase(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const mode: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 2));
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 1) orelse 220, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 220, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 225, 0, 255));
    const ok = scene3d.setPaintBase(mode, r, g, b);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// programmatic colouring + the headless paint proof.
fn hostModelPaintFace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const face: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 1) orelse 0, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 0, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 0, 0, 255));
    const ok = scene3d.paintFaceByIndex(face, r, g, b);
    if (ok) {
        model_source.writeColor(@intCast(face), r, g, b); // source-authoritative, like paint_at
        state.markDirty();
    }
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_face_count() → number of triangles in the active paint target (0 if none).
fn hostModelFaceCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, scene3d.paintFaceCount());
}

/// __model_paint_mode(mode) → sets the free-form face-safety mode (0 = clip, 1 = lock).
fn hostModelPaintMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    scene3d.paintModeSet(argToI32(info, 0) orelse 0);
}

/// __model_paint_stroke_begin(x, y) → face index the stroke locks onto (LOCK mode), or -1
/// on a miss. Call once on brush-down; the ensuing dabs read the captured face.
fn hostModelPaintStrokeBegin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    setReturnNumber(info, scene3d.paintStrokeBegin(x, y));
}

/// __model_paint_stamp(x, y, r, g, b, radius, flow[, kind, hardness, angleDeg, aspect,
/// scatter, blend]) → 1 if a face was dabbed, 0 on a miss. One free-form sub-face brush dab (see
/// scene3d.paintStampAt); fired per pointer-move during a stroke. radius is in patch-texel
/// units, flow 0..1. The optional tail is the brush FOOTPRINT (req_2831) — kind is the
/// BRUSH_SHAPE_ID contract (runtime/paint/model.ts, 0 round … 10 knife); absent = the old
/// bare round dab. Free-form paint lands directly on the paint atlas (not the per-face
/// source store), so it marks the frame dirty but does not touch model_source.
fn hostModelPaintStamp(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 0, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 0, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 4) orelse 0, 0, 255));
    const radius: f32 = @floatCast(argToF64(info, 5) orelse 2.0);
    const flow: f32 = @floatCast(argToF64(info, 6) orelse 1.0);
    const blend_raw = argToI32(info, 12) orelse 0;
    const spec = scene3d.BrushShape{
        .kind = @intCast(std.math.clamp(argToI32(info, 7) orelse 0, 0, 10)),
        .hardness = @floatCast(argToF64(info, 8) orelse 1.0),
        .angle_rad = @as(f32, @floatCast(argToF64(info, 9) orelse 0.0)) * std.math.pi / 180.0,
        .aspect = @floatCast(argToF64(info, 10) orelse 1.0),
        .scatter = @floatCast(argToF64(info, 11) orelse 0.0),
        .blend = @intCast(if (blend_raw >= 0 and blend_raw <= 7) blend_raw else 0),
    };
    const face = scene3d.paintStampAt(x, y, r, g, b, radius, flow, spec);
    if (face >= 0) state.markDirty();
    setReturnNumber(info, if (face >= 0) 1 else 0);
}

/// __model_paint_polygon(Float32Array normalizedXY, r, g, b, flow, blend) → 1|0.
/// The scene boundary raycasts and validates the complete path before touching
/// the atlas, then records it as one durable paint-journal unit.
fn hostModelPaintPolygon(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse return setReturnNumber(info, 0);
    if (bytes.len % @sizeOf(f32) != 0) return setReturnNumber(info, 0);
    const points: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, bytes));
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 1) orelse 0, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 0, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 0, 0, 255));
    const flow: f32 = @floatCast(argToF64(info, 4) orelse 1.0);
    const blend_raw = argToI32(info, 5) orelse 0;
    const ok = scene3d.paintPolygonAt(points, r, g, b, flow, @intCast(if (blend_raw >= 0 and blend_raw <= 7) blend_raw else 0));
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_paint_material(key, wgsl, data, size, scale) → 1 if the shader baked and is now
/// the active brush ink, 0 otherwise. Renders the shader recipe (key + WGSL + optional
/// Float32Array params) to a size×size image the host samples per dab — "dip the brush into a
/// bucket of shader". `key` must vary per param set (materialize caches per key). While set,
/// every dab/fill deposits the material's look instead of a flat colour, until _material_clear.
fn hostModelPaintMaterial(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const key = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(key);
    const wgsl = argToStringAlloc(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(wgsl);
    // Optional shader params as a Float32Array's bytes; empty/absent → the shader's own defaults.
    const data: ?[]const f32 = blk: {
        const bytes = argBytes(info, 2) orelse break :blk null;
        if (bytes.len == 0 or bytes.len % @sizeOf(f32) != 0) break :blk null;
        break :blk @alignCast(std.mem.bytesAsSlice(f32, bytes));
    };
    const size: u32 = @intCast(std.math.clamp(argToI32(info, 3) orelse 256, 8, 1024));
    const scale: f32 = @floatCast(argToF64(info, 4) orelse 1.0);
    if (key.len == 0 or wgsl.len == 0) {
        setReturnNumber(info, 0);
        return;
    }
    // bakePixels returns readbackStaticSurface's layout: 8-byte header (u32 w, u32 h LE) + RGBA,
    // page-allocated — we own it and free after copying the pixels into the paint module.
    const raw = material_tex.bakePixels(host.io, host.environ, key, wgsl, data, size) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.page_allocator.free(raw);
    if (raw.len < 8) {
        setReturnNumber(info, 0);
        return;
    }
    const w = std.mem.readInt(u32, raw[0..4], .little);
    const h = std.mem.readInt(u32, raw[4..8], .little);
    const ok = scene3d.setPaintMaterial(raw[8..], w, h, scale);
    if (ok) {
        // Register this shader ink in the stroke program (WGSL + params embedded) so a saved
        // painting re-bakes it at load with no catalog — the program stays self-contained.
        paint_program.activateMaterial(key, wgsl, data orelse &.{}, scale);
        state.markDirty();
    }
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_paint_material_clear() → drop the material ink; dabs go back to flat-colour painting.
fn hostModelPaintMaterialClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    scene3d.clearPaintMaterial();
    paint_program.deactivateMaterial();
    setReturnNumber(info, 1);
}

/// __model_region_formula(wgsl) → 1|0. Install the composed live-material-region
/// WGSL (region_rgb over the fill catalog) — pushed ONCE per run/hot-reload, like
/// the ground look. Per-region material picks arrive as DATA via __model_region_set.
fn hostModelRegionFormula(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const wgsl = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(wgsl);
    if (wgsl.len == 0) {
        setReturnNumber(info, 0);
        return;
    }
    scene3d.setRegionFormula(wgsl);
    state.markDirty();
    setReturnNumber(info, 1);
}

/// __model_region_set(key, regionId, Uint32Array faces, Float32Array data) → 1|0.
/// Bind (or update) one live material region on mesh `key`: `faces` are triangle
/// indices in render order, `data` is the spec's data[] + palette section (the
/// palette-slot contract) + region extras (domain scale …). The region renders
/// per-frame over object-space position — one continuous field across all faces.
fn hostModelRegionSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const key = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(key);
    const region_id = argToI32(info, 1) orelse 0;
    const face_bytes = argBytes(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (face_bytes.len == 0 or face_bytes.len % @sizeOf(u32) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const faces: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, face_bytes));
    const data_bytes = argBytes(info, 3) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (data_bytes.len == 0 or data_bytes.len % @sizeOf(f32) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const data: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, data_bytes));
    const ok = scene3d.setRegion(key, region_id, faces, data);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_region_bind_slot(key, regionId, slotIndex, Float32Array data) → 1|0.
/// Slot-bound region: membership = every face of the resident edit mesh wearing
/// texture slot `slotIndex`, resolved HOST-side at draw time — face assignment,
/// cuts, and undo flow into the region automatically. `data` as in __model_region_set.
fn hostModelRegionBindSlot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const key = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(key);
    const region_id = argToI32(info, 1) orelse 0;
    const slot_index: u32 = @intCast(@max(0, argToI32(info, 2) orelse 0));
    const data_bytes = argBytes(info, 3) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (data_bytes.len == 0 or data_bytes.len % @sizeOf(f32) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const data: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, data_bytes));
    const ok = scene3d.setRegionSlotBound(key, region_id, slot_index, data);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_region_clear(key[, regionId]) → 1. regionId >= 0 clears that one
/// region of `key`; omitted/negative clears every region of `key`; an empty key
/// clears ALL regions (model switch / unmount).
fn hostModelRegionClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var key: []const u8 = "";
    var key_owned = false;
    if (argToStringAlloc(info, 0)) |k| {
        key = k;
        key_owned = true;
    }
    defer if (key_owned) std.heap.c_allocator.free(key);
    const region_id = argToI32(info, 1) orelse -1;
    scene3d.clearRegions(key, region_id);
    state.markDirty();
    setReturnNumber(info, 1);
}

/// __model_set_paint_detail(density) → the ACTUAL density after the change. `density`
/// is texels-per-METER (Blockbench 16x semantics: 16/32/64/128, plus 256/512; 1 =
/// fill-only look). Rebuilds the island atlas and re-uploads the mesh (see
/// scene3d.setPaintDetail). An over-budget density halves inside the layout, so the
/// return is the truth, not the request.
fn hostModelSetPaintDetail(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const px = argToI32(info, 0) orelse 1;
    const applied = scene3d.setPaintDetail(px);
    state.markDirty();
    setReturnNumber(info, applied);
}

fn returnEstimateJson(info: v8.FunctionCallbackInfo, est: scene3d.PaintEstimate) void {
    var buf: [96]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"w\":{d},\"h\":{d},\"density\":{d}}}", .{ est.w, est.h, @max(1, @as(u32, @round(est.density))) }) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, json);
}

/// __model_paint_atlas_estimate(density) → JSON {"w":W,"h":H,"density":D} — the atlas
/// the island layout WOULD build for the current model at that texels-per-meter
/// density (D = the applied density after any clamp), without adopting it. "" if no
/// target. The Create Paint Atlas prompt shows these as the honest per-option cost.
fn hostModelPaintAtlasEstimate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const density: f32 = @floatCast(argToF64(info, 0) orelse 1);
    const est = scene3d.estimatePaintAtlas(density) orelse {
        setReturnString(info, "");
        return;
    };
    returnEstimateJson(info, est);
}

/// __model_set_paint_fit(texels) → the DERIVED density (texels/meter). The proven
/// painter's fidelity law (req_2518): the whole model's islands FIT a texels² atlas —
/// a lone cube gets writing-grade texels, a many-face model divides the same budget.
/// The paint fidelity dial is the atlas SIZE, not a fixed density.
fn hostModelSetPaintFit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const texels = argToI32(info, 0) orelse 1024;
    const applied = scene3d.setPaintFit(texels);
    state.markDirty();
    setReturnNumber(info, applied);
}

/// __model_paint_fit_estimate(texels) → JSON {"w":W,"h":H,"density":D} — what a
/// texels² atlas-budget fit would give this model (D = the derived density), without
/// adopting it. "" if no target.
fn hostModelPaintFitEstimate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const texels = argToI32(info, 0) orelse 1024;
    const est = scene3d.estimatePaintAtlasFit(if (texels < 64) 64 else @intCast(texels)) orelse {
        setReturnString(info, "");
        return;
    };
    returnEstimateJson(info, est);
}

/// __model_atlas_read() → JSON {"w":W,"h":H,"detail":D,"islands":[x,y,w,h,...],
/// "groups":[g,...],"triangles":[island,faceGroup,x0,y0,x1,y1,x2,y2,...],
/// "cornerVertices":[v0,v1,v2,...],
/// "data":"<base64 rgba>"} for the current painting, or "" if there's
/// no paint target. `detail` is the applied density (texels/meter); `islands` is the
/// packed island rects (flat quads, 4-stride) and `groups` the PARALLEL per-island
/// authored group id. Every island is emitted: the UV editor is an authoring surface,
/// so silently dropping a large model's rectangles is not an acceptable optimization.
/// The editor also persists this as a paint variant.
fn hostModelAtlasRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.c_allocator;
    // This read gets PERSISTED (paint variants, model packages) — lift the selection
    // tint for the duration so the saved atlas holds true paint, never the orange.
    scene3d.paintTintSuspend();
    defer scene3d.paintTintResume();
    const pa = scene3d.paintAtlas() orelse {
        setReturnString(info, "");
        return;
    };
    const enc = std.base64.standard.Encoder;
    const b64 = alloc.alloc(u8, enc.calcSize(pa.rgba.len)) catch {
        setReturnString(info, "");
        return;
    };
    defer alloc.free(b64);
    _ = enc.encode(b64, pa.rgba);

    var out: std.Io.Writer.Allocating = .init(alloc);
    defer out.deinit();
    const w = &out.writer;
    w.print("{{\"w\":{d},\"h\":{d},\"detail\":{d}", .{ pa.w, pa.h, pa.detail }) catch {
        setReturnString(info, "");
        return;
    };
    if (scene3d.paintIslands()) |isls| {
        w.writeAll(",\"islands\":[") catch return setReturnString(info, "");
        for (isls, 0..) |isl, i| {
            w.print("{s}{d},{d},{d},{d}", .{ if (i == 0) "" else ",", isl.x, isl.y, isl.w, isl.h }) catch return setReturnString(info, "");
        }
        w.writeAll("]") catch return setReturnString(info, "");
        w.writeAll(",\"groups\":[") catch return setReturnString(info, "");
        for (isls, 0..) |isl, i| {
            w.print("{s}{d}", .{ if (i == 0) "" else ",", isl.group }) catch return setReturnString(info, "");
        }
        w.writeAll("]") catch return setReturnString(info, "");
        w.writeAll(",\"triangles\":[") catch return setReturnString(info, "");
        const face_count = scene3d.paintFaceCount();
        var face: u32 = 0;
        var emitted: usize = 0;
        while (face < face_count) : (face += 1) {
            const triangle = scene3d.paintUvTriangle(face) orelse continue;
            w.print("{s}{d},{d},{d},{d},{d},{d},{d},{d}", .{
                if (emitted == 0) "" else ",",
                triangle.island,
                scene3d.paintFaceGroup(face),
                triangle.corners[0],
                triangle.corners[1],
                triangle.corners[2],
                triangle.corners[3],
                triangle.corners[4],
                triangle.corners[5],
            }) catch return setReturnString(info, "");
            emitted += 1;
        }
        w.writeAll("]") catch return setReturnString(info, "");
        w.writeAll(",\"cornerVertices\":[") catch return setReturnString(info, "");
        face = 0;
        emitted = 0;
        while (face < face_count) : (face += 1) {
            const fallback = [3]u32{ face * 3, face * 3 + 1, face * 3 + 2 };
            const vertices = scene3d.paintUvCornerVertices(face) orelse fallback;
            w.print("{s}{d},{d},{d}", .{
                if (emitted == 0) "" else ",",
                vertices[0],
                vertices[1],
                vertices[2],
            }) catch return setReturnString(info, "");
            emitted += 1;
        }
        w.writeAll("]") catch return setReturnString(info, "");
    }
    w.print(",\"data\":\"{s}\"}}", .{b64}) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, out.written());
}

/// __model_uv_layout_apply(Uint32Array[x,y,w,h,...]) → 1 on atomic success.
/// The table must describe every current island; validation and the UV-only mesh
/// rewrite happen together behind scene3d's single deep boundary.
fn hostModelUvLayoutApply(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (bytes.len == 0 or bytes.len % (4 * @sizeOf(u32)) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const rects: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, bytes));
    const ok = scene3d.applyUvIslandRects(rects);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_uv_geometry_apply(Float32Array[x0,y0,x1,y1,x2,y2,...], action?) → 1.
/// One six-float row is required for every current render face. The scene boundary
/// validates the complete table before rewriting any resident UV or island bound.
/// Supplying a valid UV-action ordinal journals the completed edit as one unit;
/// omission is reserved for document hydration/back-compat callers.
fn hostModelUvGeometryApply(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (bytes.len == 0 or bytes.len % (6 * @sizeOf(f32)) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const corners: []const f32 = @alignCast(std.mem.bytesAsSlice(f32, bytes));
    const action = argToI32(info, 1);
    const ok = if (action) |raw|
        if (mesh_journal_log.uvActionLabel(raw)) |label|
            scene3d.applyUvCornerGeometryJournaled(corners, label)
        else
            false
    else
        scene3d.applyUvCornerGeometry(corners);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_uv_restore_shape(Uint32Array[island,...]) → 1. Reproject the selected
/// islands from the resident 3D mesh, keeping their current UV centres and committing
/// the result as one journaled UV action.
fn hostModelUvRestoreShape(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (bytes.len == 0 or bytes.len % @sizeOf(u32) != 0) {
        setReturnNumber(info, 0);
        return;
    }
    const island_indices: []const u32 = @alignCast(std.mem.bytesAsSlice(u32, bytes));
    const ok = scene3d.restoreUvIslandShapesJournaled(island_indices);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_uv_selection_read() → JSON {"islands":[...],"faces":[...]}. The UV panel
/// polls this only when native model selection commits, avoiding an expensive
/// atlas-byte read merely to synchronize selection and corner-identity chrome.
fn hostModelUvSelectionRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const islands = scene3d.paintIslands() orelse {
        setReturnString(info, "{\"islands\":[],\"faces\":[]}");
        return;
    };
    var out: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer out.deinit();
    const writer = &out.writer;
    writer.writeAll("{\"islands\":[") catch return setReturnString(info, "{\"islands\":[],\"faces\":[]}");
    var emitted: usize = 0;
    for (islands, 0..) |_, island_index| {
        if (!scene3d.paintIslandSelected(@intCast(island_index))) continue;
        writer.print("{s}{d}", .{ if (emitted == 0) "" else ",", island_index }) catch return setReturnString(info, "{\"islands\":[],\"faces\":[]}");
        emitted += 1;
    }
    writer.writeAll("],\"faces\":[") catch return setReturnString(info, "{\"islands\":[],\"faces\":[]}");
    emitted = 0;
    var face: u32 = 0;
    while (face < scene3d.paintFaceCount()) : (face += 1) {
        if (!scene3d.paintFaceSelected(face)) continue;
        writer.print("{s}{d}", .{ if (emitted == 0) "" else ",", face }) catch return setReturnString(info, "{\"islands\":[],\"faces\":[]}");
        emitted += 1;
    }
    writer.writeAll("]}") catch return setReturnString(info, "{\"islands\":[],\"faces\":[]}");
    setReturnString(info, out.written());
}

/// __model_uv_island_select(index, additive) → 1. UV clicks enter the same native
/// authored-face selection consumed by the 3D viewport; there is no panel-only set.
fn hostModelUvIslandSelect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const index_raw = argToI32(info, 0) orelse -1;
    if (index_raw < 0) {
        setReturnNumber(info, 0);
        return;
    }
    const additive = (argToI32(info, 1) orelse 0) != 0;
    const ok = scene3d.meshEditSelectPaintIsland(@intCast(index_raw), additive);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_atlas_replace(Uint8Array rgba, journal=0) → 1. External texture editors write
/// atlases/base.png; this door reloads its decoded, equal-sized RGBA into the
/// current atlas without repacking the authored UV rectangles.
fn hostModelAtlasReplace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rgba = argBytes(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const journal = (argToI32(info, 1) orelse 0) != 0;
    const ok = if (journal) scene3d.replacePaintAtlasJournaled(rgba) else scene3d.replacePaintAtlas(rgba);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_atlas_import(Uint8Array rgba, width, height, journal=0) → 1. Adopt an imported
/// image at its native dimensions while uniformly fitting the current UV geometry so
/// non-square atlases cannot stretch circles into ovals.
fn hostModelAtlasImport(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rgba = argBytes(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const width_raw = argToI32(info, 1) orelse 0;
    const height_raw = argToI32(info, 2) orelse 0;
    if (width_raw <= 0 or height_raw <= 0) {
        setReturnNumber(info, 0);
        return;
    }
    const journal = (argToI32(info, 3) orelse 0) != 0;
    const ok = if (journal)
        scene3d.importPaintAtlasJournaled(rgba, @intCast(width_raw), @intCast(height_raw))
    else
        scene3d.importPaintAtlas(rgba, @intCast(width_raw), @intCast(height_raw));
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_paint_sample(x, y) → packed 0xRRGGBB colour under the viewport pixel, -1 on a
/// miss — the model painter's eyedropper (req_3097). Reads TRUE paint: the selection tint
/// is lifted for the read, same law as __model_atlas_read.
fn hostModelPaintSample(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    scene3d.paintTintSuspend();
    defer scene3d.paintTintResume();
    const rgb = scene3d.samplePaintAt(x, y) orelse {
        setReturnNumber(info, -1);
        return;
    };
    const packed_rgb: u32 = (@as(u32, rgb[0]) << 16) | (@as(u32, rgb[1]) << 8) | rgb[2];
    setReturnNumber(info, packed_rgb);
}

/// __model_atlas_palette(n) → JSON [[r,g,b],...] — the current painting's n dominant
/// colours, most-covered first; "[]" when no paint target. The colour library's SCENE
/// row reads real scene colours from here (req_3097). Tint lifted, as every atlas read.
fn hostModelAtlasPalette(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.c_allocator;
    const n: usize = @intCast(std.math.clamp(argToI32(info, 0) orelse 8, 1, 16));
    var colors: [16][3]u8 = undefined;
    scene3d.paintTintSuspend();
    defer scene3d.paintTintResume();
    const wrote = scene3d.paintAtlasPalette(colors[0..n]);
    var out: std.Io.Writer.Allocating = .init(alloc);
    defer out.deinit();
    const w = &out.writer;
    w.writeAll("[") catch return setReturnString(info, "[]");
    for (colors[0..wrote], 0..) |rgb, i| {
        w.print("{s}[{d},{d},{d}]", .{ if (i == 0) "" else ",", rgb[0], rgb[1], rgb[2] }) catch return setReturnString(info, "[]");
    }
    w.writeAll("]") catch return setReturnString(info, "[]");
    setReturnString(info, out.written());
}

/// __model_atlas_apply(detail, base64) → 1 on success, 0 on failure. Restore a saved painting:
/// the host re-tessellates to `detail` then blits the decoded atlas back over the texture.
fn hostModelAtlasApply(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.c_allocator;
    const detail = argToI32(info, 0) orelse 1;
    const b64 = argToStringAlloc(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer alloc.free(b64);
    const dec = std.base64.standard.Decoder;
    const n = dec.calcSizeForSlice(b64) catch {
        setReturnNumber(info, 0);
        return;
    };
    const raw = alloc.alloc(u8, n) catch {
        setReturnNumber(info, 0);
        return;
    };
    defer alloc.free(raw);
    dec.decode(raw, b64) catch {
        setReturnNumber(info, 0);
        return;
    };
    const ok = scene3d.applyPaintAtlas(detail, raw);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_paint_program_read() → base64 of the recorded STROKE PROGRAM (the durable painting —
/// strokes + params, not the rasterized atlas), or "" if nothing's been painted. This is what
/// the editor persists instead of the atlas (GUIDING_LIGHT: store the recipe, not the pixels).
fn hostModelPaintProgramRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.c_allocator;
    const blob = scene3d.paintProgramRead() orelse {
        setReturnString(info, "");
        return;
    };
    defer alloc.free(blob);
    const enc = std.base64.standard.Encoder;
    const b64 = alloc.alloc(u8, enc.calcSize(blob.len)) catch {
        setReturnString(info, "");
        return;
    };
    defer alloc.free(b64);
    _ = enc.encode(b64, blob);
    setReturnString(info, b64);
}

/// __model_paint_baseline_read() → base64 RGBA for the exact raster beneath the
/// stroke program, or "" when no baseline has been authored yet.
fn hostModelPaintBaselineRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.c_allocator;
    const rgba = scene3d.paintProgramBaseline() orelse return setReturnString(info, "");
    const enc = std.base64.standard.Encoder;
    const b64 = alloc.alloc(u8, enc.calcSize(rgba.len)) catch return setReturnString(info, "");
    defer alloc.free(b64);
    _ = enc.encode(b64, rgba);
    setReturnString(info, b64);
}

/// __model_paint_program_apply(base64) → 1 on success, 0 on failure. Replay a saved stroke
/// program onto the resident model, rebuilding the atlas from the recipe (re-baking any shader
/// inks from their embedded WGSL). The self-contained restore that replaces atlas-blit.
fn hostModelPaintProgramApply(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const alloc = std.heap.c_allocator;
    const b64 = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer alloc.free(b64);
    const dec = std.base64.standard.Decoder;
    const n = dec.calcSizeForSlice(b64) catch {
        setReturnNumber(info, 0);
        return;
    };
    const blob = alloc.alloc(u8, n) catch {
        setReturnNumber(info, 0);
        return;
    };
    defer alloc.free(blob);
    dec.decode(blob, b64) catch {
        setReturnNumber(info, 0);
        return;
    };
    const ok = scene3d.paintProgramApply(host.io, host.environ, blob);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_paint_program_apply_over_base(base64) → 1 on success. The caller has
/// already installed raster-base.png; this adopts/replays the editable recipe on top.
fn hostModelPaintProgramApplyOverBase(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const alloc = std.heap.c_allocator;
    const b64 = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(b64);
    const dec = std.base64.standard.Decoder;
    const n = dec.calcSizeForSlice(b64) catch return setReturnNumber(info, 0);
    const blob = alloc.alloc(u8, n) catch return setReturnNumber(info, 0);
    defer alloc.free(blob);
    dec.decode(blob, b64) catch return setReturnNumber(info, 0);
    const ok = scene3d.paintProgramApplyOverBase(host.io, host.environ, blob);
    if (ok) state.markDirty();
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __file_sha256(path) → 64-char lowercase hex of the file's bytes, or "" on read
/// failure. Content-addresses an imported asset so its attribution follows the BYTES,
/// not the filename — a renamed or re-downloaded copy resolves to the same entry.
fn hostFileSha256(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const path = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(path);
    const data = std.Io.Dir.cwd().readFileAlloc(io, path, std.heap.c_allocator, .limited(512 * 1024 * 1024)) catch {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(data);
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(data, &digest, .{});
    var hex: [64]u8 = undefined;
    const charset = "0123456789abcdef";
    for (digest, 0..) |byte, i| {
        hex[i * 2] = charset[byte >> 4];
        hex[i * 2 + 1] = charset[byte & 0xf];
    }
    setReturnString(info, &hex);
}

/// __model_set_quality(grid) → JSON {"key","count"} | "". Re-decimate the retained
/// full-res source mesh to clustering resolution `grid` (2..1024; higher = more
/// detail), swap it in as the resident + paint target under a quality-specific key, and
/// nominate that displayed topology for the next durable model save. The retained
/// baseline still makes slider changes reversible until Save/reopen establishes the
/// chosen reduction as the document's new full source. The camera is left alone.
fn hostModelSetQuality(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const grid: u32 = @intCast(std.math.clamp(argToI32(info, 0) orelse 64, 2, 1024));
    const src = model_source.verts() orelse {
        setReturnString(info, "");
        return;
    };
    const base = model_source.path() orelse "model";

    var dec = mesh_import.decimateExpanded(std.heap.c_allocator, src, model_source.count(), grid) catch {
        setReturnString(info, "");
        return;
    };
    defer dec.deinit(std.heap.c_allocator);

    // Quality-specific key so each level interns as its own resident geometry.
    const key = std.fmt.allocPrint(std.heap.c_allocator, "{s}#q{d}", .{ base, grid }) catch {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(key);

    scene3d.setQualityPaintTarget(key, dec.mesh.verts, dec.mesh.vert_count);
    if (!scene3d.stashHostMesh(key, dec.mesh.verts, dec.mesh.vert_count)) {
        setReturnString(info, "");
        return;
    }

    // Carry the authoritative source paint down onto this level: each new face takes the
    // colour of the source face it came from. So lowering quality keeps your paint.
    if (model_source.colors()) |src_cols| {
        const nfaces = dec.face_to_source.len;
        if (std.heap.c_allocator.alloc(u8, nfaces * 4)) |carried| {
            defer std.heap.c_allocator.free(carried);
            for (dec.face_to_source, 0..) |sf, i| {
                if (@as(usize, sf) * 4 + 3 < src_cols.len) {
                    carried[i * 4 + 0] = src_cols[sf * 4 + 0];
                    carried[i * 4 + 1] = src_cols[sf * 4 + 1];
                    carried[i * 4 + 2] = src_cols[sf * 4 + 2];
                    carried[i * 4 + 3] = src_cols[sf * 4 + 3];
                }
            }
            scene3d.applyPaintColors(carried);
        } else |_| {}
    }
    model_source.setFaceMap(dec.face_to_source);
    state.markDirty();

    var buf: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer buf.deinit();
    const w = &buf.writer;
    w.writeAll("{\"key\":\"") catch {
        setReturnString(info, "");
        return;
    };
    for (key) |ch| {
        switch (ch) {
            '"' => w.writeAll("\\\"") catch return,
            '\\' => w.writeAll("\\\\") catch return,
            0...8, 9...10, 11...31 => w.print("\\u{x:0>4}", .{ch}) catch return,
            else => w.writeByte(ch) catch return,
        }
    }
    w.print("\",\"count\":{d}}}", .{dec.mesh.vert_count}) catch {
        setReturnString(info, "");
        return;
    };
    setReturnString(info, buf.written());
}

fn hostReleaseFileBuffer(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const id = argToI32(info, 0) orelse return;
    if (id <= 0) return;
    if (!g_content_store_inited) return;
    if (g_content_store.fetchRemove(@intCast(id))) |entry| {
        std.heap.c_allocator.free(entry.value);
    }
}

fn hostLog(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const sev = argToI32(info, 0) orelse 0;
    const msg = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(msg);
    // Route JS console.log/warn/error through the bus instead of std.log.
    // (Going through std.log would round-trip back into the bus via the
    // logFn override, which works but adds noise in scope=default.)
    _ = event_bus.emitJsLog(sev, msg);
}

fn hostJsEval(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setReturnString(info, "");
        return;
    }
    const code = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(code);
    var buf: [16384]u8 = undefined;
    const result = v8_runtime.evalToString(code, buf[0..]);
    setReturnString(info, result);
}

// ── Latches ─────────────────────────────────────────────
//
// __latchSet(key: string, value: number) — writes a host-owned
// numeric value the layout engine reads at frame time. See
// framework/latches.zig.
fn hostLatchSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const key = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(key);
    const value = argToF64(info, 1) orelse return;
    latches.set(key, value);
}

fn hostLatchGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setReturnNumber(info, 0);
        return;
    }
    const key = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(key);
    setReturnNumber(info, latches.get(key));
}

// __anim_register(latchKey: string, curveName: string, loopName: string,
//                 from: number, to: number, durationMs: number) -> number
//
// Registers a host-side animation. Returns the animation id (>0) on
// success, 0 on failure (pool full, key too long, etc). The cart
// stores the id and calls __anim_unregister(id) on cleanup.
fn hostAnimRegister(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 6) {
        setReturnNumber(info, 0);
        return;
    }
    const key = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(key);
    const curve_name = argToStringAlloc(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(curve_name);
    const loop_name = argToStringAlloc(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(loop_name);
    const from = argToF64(info, 3) orelse 0;
    const to = argToF64(info, 4) orelse 0;
    const duration_ms = argToF64(info, 5) orelse 1000;
    // Optional 7th arg: start_offset_ms (default 0). Lets callers
    // stagger N animations that share a curve so each has a different
    // phase — the wave-with-offset pattern.
    const start_offset_ms: i64 = blk: {
        if (info.length() < 7) break :blk 0;
        const v = argToF64(info, 6) orelse break :blk 0;
        break :blk @trunc(v);
    };

    const curve = animations.CurveType.fromString(curve_name);
    const loop: animations.LoopMode = blk: {
        if (std.mem.eql(u8, loop_name, "once")) break :blk .once;
        if (std.mem.eql(u8, loop_name, "pingpong")) break :blk .pingpong;
        break :blk .cycle;
    };
    const now_ms = std.Io.Clock.now(.awake, v8_runtime.hostContext(info.getIsolate()).io).toMilliseconds();
    const id = animations.register(
        key,
        curve,
        loop,
        @floatCast(from),
        @floatCast(to),
        @floatCast(duration_ms),
        now_ms,
        start_offset_ms,
    );
    setReturnNumber(info, id);
}

fn hostAnimUnregister(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const id_f = argToF64(info, 0) orelse return;
    const id: u32 = @trunc(id_f);
    animations.unregister(id);
}

fn hostGetMouseX(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatCast(mouse_state.g_mouse_x));
}

fn hostGetMouseY(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatCast(mouse_state.g_mouse_y));
}

fn hostViewportWidth(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatCast(system_signals.getViewportWidth()));
}

fn hostViewportHeight(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatCast(system_signals.getViewportHeight()));
}

fn hostGetMouseDown(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (mouse_state.g_mouse_down) 1 else 0);
}

/// Live SDL_Keymod state for pointer payloads, including left/right variants.
fn hostGetMouseMods(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, c.SDL_GetModState());
}

/// Which device last drove the pointer: 0 = mouse, 1 = pen (Wacom/tablet).
/// Flips on the first event from the other device; the change edge also fires
/// the useIFTTT `system:pointerDevice` signal (engine.zig notePointerDevice).
fn hostGetPointerDevice(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @intFromEnum(mouse_state.g_pointer_device));
}

/// Live pen pressure 0..1 (SDL_PEN_AXIS_PRESSURE; 0 when the pen is lifted).
/// Meaningless for a mouse — the JS pointer payload only reads it when
/// getPointerDevice() says pen.
fn hostGetPenPressure(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatCast(mouse_state.g_pen_pressure));
}

fn hostGetMouseRightDown(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (mouse_state.g_mouse_right_down) 1 else 0);
}

/// Live SDL button mask (1 left · 2 middle · 4 right) — lets a cart poll a
/// held middle-drag, which never enters the LEFT-only JS capture pipeline.
fn hostGetMouseButtons(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const mask = c.SDL_GetMouseState(null, null);
    setReturnNumber(info, mask);
}

fn hostMouseCapture(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const enabled = (argToI32(info, 0) orelse 0) != 0;
    input.unfocus();
    const ok = @import("engine.zig").setRelativeMouseMode(enabled);
    setReturnNumber(info, if (ok) 1 else 0);
}

fn hostMouseDelta(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ctx = infoCtx(info);
    const delta = mouse_state.consumeMouseDelta();
    const obj = newObject(info);
    objectSetNumber(obj, ctx, "dx", @floatCast(delta[0]));
    objectSetNumber(obj, ctx, "dy", @floatCast(delta[1]));
    info.getReturnValue().set(obj);
}

fn hostInputUnfocus(_: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    input.unfocus();
}

fn hostIsKeyDown(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setReturnNumber(info, 0);
        return;
    }
    const scancode = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) {
        setReturnNumber(info, 0);
        return;
    }
    const pressed = keys[@intCast(scancode)];
    setReturnNumber(info, if (pressed) 1 else 0);
}

fn hostClipboardSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const s = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(s);
    const z = std.heap.c_allocator.alloc(u8, s.len + 1) catch return;
    defer std.heap.c_allocator.free(z);
    @memcpy(z[0..s.len], s);
    z[s.len] = 0;
    _ = c.SDL_SetClipboardText(z.ptr);
}

fn hostClipboardGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const clip = c.SDL_GetClipboardText();
    if (clip == null) {
        setReturnString(info, "");
        return;
    }
    defer c.SDL_free(@ptrCast(clip));
    setReturnString(info, std.mem.span(clip));
}

/// __selection_get() — return the active highlighted text, mirroring what
/// Ctrl+C would copy:
///   focused input with a range  → that input's selected slice
///   tree-text selection         → walked text from selection.zig
///   neither                     → ""
/// Carts use this to gate "Copy" menu items on real selection state.
fn hostSelectionGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (input.getFocusedId()) |fid| {
        const sel = input.getSelectedText(fid);
        if (sel.len > 0) {
            setReturnString(info, sel);
            return;
        }
    }
    var buf: [4096]u8 = undefined;
    const n = selection.copySelectionToBuf(&buf);
    setReturnString(info, buf[0..n]);
}

/// __selection_clear() — drop the app-wide tree text selection (selection.zig
/// `sel_all`/`sel_node`). A cart that handles Ctrl+A itself (e.g. the Studio's
/// "select all faces") calls this so the host's Ctrl+A "select all text across the
/// whole tree" doesn't ALSO light up every label in the app (USER req_1058). Runs
/// synchronously in the same key dispatch, so the highlight never renders.
fn hostSelectionClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    selection.clear();
}

fn hostSysDropPath(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnString(info, system_signals.getDropPath());
}

fn hostSysSelectionGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnString(info, selection_watch.getText());
}

fn hostPollInputSubmit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const evt = input.consumeLastSubmit() orelse return;
    const ctx = infoCtx(info);
    const obj = newObject(info);
    objectSetNumber(obj, ctx, "id", evt.id);
    objectSetString(obj, ctx, "text", evt.text);
    info.getReturnValue().set(obj);
}

fn hostGetPreparedRightClick(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ctx = infoCtx(info);
    const obj = newObject(info);
    objectSetNumber(obj, ctx, "x", @floatCast(@field(prepared_input, "g_prepared_mouse_x")));
    objectSetNumber(obj, ctx, "y", @floatCast(@field(prepared_input, "g_prepared_mouse_y")));
    info.getReturnValue().set(obj);
}

fn hostGetPreparedScroll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ctx = infoCtx(info);
    const obj = newObject(info);
    objectSetNumber(obj, ctx, "scrollX", @floatCast(@field(prepared_input, "g_prepared_scroll_x")));
    objectSetNumber(obj, ctx, "scrollY", @floatCast(@field(prepared_input, "g_prepared_scroll_y")));
    objectSetNumber(obj, ctx, "deltaX", @floatCast(@field(prepared_input, "g_prepared_scroll_dx")));
    objectSetNumber(obj, ctx, "deltaY", @floatCast(@field(prepared_input, "g_prepared_scroll_dy")));
    info.getReturnValue().set(obj);
}

// Async exec — __exec_async(cmd, rid). Runs the command in the root-injected
// Io executor; the result is drained by tickDrain() and delivered to JS
// via __ffiEmit('exec:<rid>', JSON.stringify({stdout, code})).
fn hostExecAsync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const cmd = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(cmd);
    const rid = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(rid);
    _ = g_exec_executor.spawn(rid, cmd);
}

fn emitExecResult(host: *HostContext, rid: []const u8, stdout: []const u8, code: i32) void {
    // Build JSON payload. Only escape the couple of chars we need for stdout;
    // stdout can be arbitrary text with quotes/newlines/backslashes.
    var buf: std.Io.Writer.Allocating = .init(std.heap.c_allocator);
    defer buf.deinit();
    const w = &buf.writer;
    w.print("{{\"code\":{d},\"stdout\":\"", .{code}) catch return;
    for (stdout) |ch| {
        switch (ch) {
            '"' => w.writeAll("\\\"") catch return,
            '\\' => w.writeAll("\\\\") catch return,
            '\n' => w.writeAll("\\n") catch return,
            '\r' => w.writeAll("\\r") catch return,
            '\t' => w.writeAll("\\t") catch return,
            0...8, 11, 12, 14...31 => w.print("\\u{x:0>4}", .{ch}) catch return,
            else => w.writeByte(ch) catch return,
        }
    }
    w.writeAll("\"}") catch return;
    const payload = buf.written();

    // Build channel string "exec:<rid>" nul-terminated for callGlobal2Str.
    var chan: std.ArrayList(u8) = .empty;
    defer chan.deinit(std.heap.c_allocator);
    chan.appendSlice(std.heap.c_allocator, "exec:") catch return;
    chan.appendSlice(std.heap.c_allocator, rid) catch return;
    chan.append(std.heap.c_allocator, 0) catch return;
    const chan_z = chan.items[0 .. chan.items.len - 1 :0];

    var payload_arr: std.ArrayList(u8) = .empty;
    defer payload_arr.deinit(std.heap.c_allocator);
    payload_arr.appendSlice(std.heap.c_allocator, payload) catch return;
    payload_arr.append(std.heap.c_allocator, 0) catch return;
    const payload_z = payload_arr.items[0 .. payload_arr.items.len - 1 :0];

    v8_runtime.callGlobal2Str(host, "__ffiEmit", chan_z, payload_z);
}

/// Per-frame drain. Currently emits results from completed async exec calls
/// to JS via __ffiEmit (the listener path defers through setTimeout, so the
/// listener actually runs on the *next* __jsTick — no ordering dependency
/// vs __jsTick itself). Renamed from execTickDrain to fit the uniform
/// tickDrain() name that INGREDIENTS in v8_app.zig expects.
pub fn tickDrain(host: *HostContext) void {
    g_exec_executor.drain(host, emitExecResult);
}

// The pending-flush queue + drain + reload-clear moved to
// framework/v8_bindings_reconciler.zig. Callers route through
// `v8_bindings_reconciler.drainPending` / `clearPending` now.

pub fn contentStoreGet(id: u32) ?[]const u8 {
    if (!g_content_store_inited) return null;
    return g_content_store.get(id);
}

pub fn contentStoreTake(id: u32) ?[]u8 {
    if (!g_content_store_inited) return null;
    if (g_content_store.fetchRemove(id)) |entry| return entry.value;
    return null;
}

// ── Router host functions (framework/router.zig) ────────────
fn hostRouterInit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse {
        router.init("/");
        return;
    };
    defer std.heap.c_allocator.free(path);
    router.init(path);
}

fn hostRouterPush(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(path);
    router.push(path);
    state.markDirty();
}

fn hostRouterReplace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(path);
    router.replace(path);
    state.markDirty();
}

fn hostRouterBack(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    router.back();
    state.markDirty();
}

fn hostRouterForward(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    router.forward();
    state.markDirty();
}

fn hostRouterCurrentPath(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnString(info, router.currentPath());
}

// ── Filedrop host functions (framework/filedrop.zig) ─────────
fn hostFiledropLastPath(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (filedrop.getLastPath()) |p| setReturnString(info, p) else setReturnString(info, "");
}

fn hostFiledropSeq(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(filedrop.getDropSeq()));
}

// ── localstore host functions (framework/localstore.zig) ─────
// Reads allocate (localstore.getAlloc) — the old fixed 64KB buffer silently
// returned "" for big values, the read-side twin of the 8KB write cap that
// ate painted custom-textures records.
var g_localstore_keys_json_buf: [64 * 1024]u8 = undefined;

fn hostLocalstoreGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(key);
    const value = localstore.getAlloc(io, std.heap.c_allocator, ns, key) catch {
        setReturnString(info, "");
        return;
    };
    if (value) |v| {
        defer std.heap.c_allocator.free(v);
        setReturnString(info, v);
    } else {
        setReturnString(info, "");
    }
}

fn hostLocalstoreHas(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(key);
    const found = localstore.has(io, ns, key) catch {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (found) 1 else 0);
}

fn hostLocalstoreSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(key);
    const value = argToStringAlloc(info, 2) orelse return;
    defer std.heap.c_allocator.free(value);
    localstore.set(io, ns, key, value) catch |err| {
        // a swallowed set is invisible data loss (the 8KB-cap bug hid behind
        // exactly this catch) — fail loud on stderr
        std.debug.print("[localstore] SET FAILED ns={s} key={s} len={d}: {s}\n", .{ ns, key, value.len, @errorName(err) });
    };
}

fn hostLocalstoreDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(key);
    localstore.delete(io, ns, key) catch {};
}

fn hostLocalstoreClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    if (info.length() < 1) {
        localstore.clear(io, null) catch {};
        return;
    }
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    if (ns.len == 0) {
        localstore.clear(io, null) catch {};
    } else {
        localstore.clear(io, ns) catch {};
    }
}

fn hostLocalstoreKeysJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "[]");
        return;
    };
    defer std.heap.c_allocator.free(ns);

    var entries: [localstore.MAX_KEYS]localstore.KeyEntry = undefined;
    const count = localstore.keys(io, ns, &entries) catch {
        setReturnString(info, "[]");
        return;
    };

    var pos: usize = 0;
    if (pos < g_localstore_keys_json_buf.len) {
        g_localstore_keys_json_buf[pos] = '[';
        pos += 1;
    }

    var i: usize = 0;
    while (i < count) : (i += 1) {
        if (i > 0) {
            if (pos >= g_localstore_keys_json_buf.len) break;
            g_localstore_keys_json_buf[pos] = ',';
            pos += 1;
        }
        if (pos >= g_localstore_keys_json_buf.len) break;
        g_localstore_keys_json_buf[pos] = '"';
        pos += 1;

        for (entries[i].key()) |ch| {
            if (ch == '"' or ch == '\\') {
                if (pos + 2 > g_localstore_keys_json_buf.len) break;
                g_localstore_keys_json_buf[pos] = '\\';
                pos += 1;
            } else if (ch < 0x20) {
                continue;
            } else if (pos + 1 > g_localstore_keys_json_buf.len) break;
            g_localstore_keys_json_buf[pos] = ch;
            pos += 1;
        }

        if (pos >= g_localstore_keys_json_buf.len) break;
        g_localstore_keys_json_buf[pos] = '"';
        pos += 1;
    }

    if (pos < g_localstore_keys_json_buf.len) {
        g_localstore_keys_json_buf[pos] = ']';
        pos += 1;
    }

    setReturnString(info, g_localstore_keys_json_buf[0..pos]);
}

// ── fswatch host functions (framework/fswatch.zig) ───────────
// Engine ticks fswatch.tick() every frame; events accumulate into the
// internal queue. JS drains via __fswatchDrain. Format is JSON:
// [{"w":N,"t":"created"|"modified"|"deleted","p":"path","s":bytes,"m":mtime_ns},...]
var g_fswatch_drain_buf: [128 * 1024]u8 = undefined;

fn hostFswatchAdd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const path = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, -1);
        return;
    };
    defer std.heap.c_allocator.free(path);
    const recursive = (argToI32(info, 1) orelse 0) != 0;
    const interval_ms: u32 = @intCast(@max(0, argToI32(info, 2) orelse 1000));
    const has_pattern = info.length() > 3;
    var pat_owned: ?[]u8 = null;
    if (has_pattern) {
        pat_owned = argToStringAlloc(info, 3);
    }
    defer if (pat_owned) |p| std.heap.c_allocator.free(p);

    const id = fswatch.addWatcher(io, .{
        .path = path,
        .recursive = recursive,
        .interval_ms = interval_ms,
        .pattern = if (pat_owned) |p| if (p.len > 0) p else null else null,
    }) catch {
        setReturnNumber(info, -1);
        return;
    };
    setReturnNumber(info, id);
}

fn hostFswatchRemove(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse return;
    if (id < 0 or id >= fswatch.MAX_WATCHERS) return;
    fswatch.removeWatcher(@intCast(id));
}

fn hostFswatchDrain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var events: [fswatch.MAX_EVENTS]fswatch.ChangeEvent = undefined;
    const n = fswatch.drainEvents(&events);

    // Build JSON: [{"w":N,"t":"...","p":"...","s":N,"m":N}, ...]
    var pos: usize = 0;
    g_fswatch_drain_buf[pos] = '[';
    pos += 1;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        if (i > 0) {
            if (pos >= g_fswatch_drain_buf.len) break;
            g_fswatch_drain_buf[pos] = ',';
            pos += 1;
        }
        const ev = &events[i];
        const type_str = switch (ev.change_type) {
            .created => "created",
            .modified => "modified",
            .deleted => "deleted",
        };
        const written = std.fmt.bufPrint(
            g_fswatch_drain_buf[pos..],
            "{{\"w\":{d},\"t\":\"{s}\",\"p\":\"",
            .{ ev.watcher_id, type_str },
        ) catch break;
        pos += written.len;
        // Path with minimal escaping (backslash + quote only).
        for (ev.path()) |ch| {
            if (pos + 2 >= g_fswatch_drain_buf.len) break;
            if (ch == '"' or ch == '\\') {
                g_fswatch_drain_buf[pos] = '\\';
                pos += 1;
            }
            g_fswatch_drain_buf[pos] = ch;
            pos += 1;
        }
        const tail = std.fmt.bufPrint(
            g_fswatch_drain_buf[pos..],
            "\",\"s\":{d},\"m\":{d}}}",
            .{ ev.size, ev.mtime_ns },
        ) catch break;
        pos += tail.len;
    }
    if (pos < g_fswatch_drain_buf.len) {
        g_fswatch_drain_buf[pos] = ']';
        pos += 1;
    }
    setReturnString(info, g_fswatch_drain_buf[0..pos]);
}

pub fn registerCore(host: *HostContext) void {
    g_exec_executor.init(host.io, std.heap.c_allocator);
    ensureContentStore();
    v8_runtime.registerHostFn("__dev_reload_set_policy", hostDevReloadSetPolicy);
    v8_runtime.registerHostFn("__dev_reload_waiting", hostDevReloadWaiting);
    v8_runtime.registerHostFn("__dev_reload_apply", hostDevReloadApply);
    v8_runtime.registerHostFn("__dev_reload_revision", hostDevReloadRevision);
    // __hostFlush is registered by framework/v8_bindings_reconciler.zig
    // (the shell calls reconciler.register() directly).
    v8_runtime.registerHostFn("__getInputTextForNode", hostGetInputTextForNode);
    v8_runtime.registerHostFn("__hostLoadFileToBuffer", hostLoadFileToBuffer);
    v8_runtime.registerHostFn("__hostUploadFloatBuffer", hostUploadFloatBuffer);
    v8_runtime.registerHostFn("__scene3d_patch_dyn", hostScene3DPatchDyn);
    v8_runtime.registerHostFn("__mesh_load_file", hostMeshLoadFile);
    v8_runtime.registerHostFn("__mesh_preview_file", hostMeshPreviewFile);
    v8_runtime.registerHostFn("__mesh_load_vertices", hostMeshLoadVertices);
    v8_runtime.registerHostFn("__mesh_set_face_groups", hostMeshSetFaceGroups);
    v8_runtime.registerHostFn("__mesh_set_face_materials", hostMeshSetFaceMaterials);
    v8_runtime.registerHostFn("__mesh_texture_slot_assign", hostMeshTextureSlotAssign);
    v8_runtime.registerHostFn("__mesh_texture_slot_clear", hostMeshTextureSlotClear);
    v8_runtime.registerHostFn("__mesh_texture_slot_remove", hostMeshTextureSlotRemove);
    v8_runtime.registerHostFn("__mesh_texture_slot_select", hostMeshTextureSlotSelect);
    v8_runtime.registerHostFn("__model_orbit_drag", hostModelOrbitDrag);
    v8_runtime.registerHostFn("__model_orbit_zoom", hostModelOrbitZoom);
    v8_runtime.registerHostFn("__model_orbit_pan", hostModelOrbitPan);
    v8_runtime.registerHostFn("__model_orbit_lock", hostModelOrbitLock);
    v8_runtime.registerHostFn("__model_cam_pose", hostModelCamPose);
    v8_runtime.registerHostFn("__model_cam_set_pose", hostModelCamSetPose);
    v8_runtime.registerHostFn("__model_bd_gizmo_set", hostModelBdGizmoSet);
    v8_runtime.registerHostFn("__model_bd_gizmo_clear", hostModelBdGizmoClear);
    v8_runtime.registerHostFn("__model_bd_gizmo_pos", hostModelBdGizmoPos);
    v8_runtime.registerHostFn("__model_session_json", hostModelSessionJson);
    v8_runtime.registerHostFn("__model_focus_at", hostModelFocusAt);
    v8_runtime.registerHostFn("__mesh_edit_mode", hostMeshEditMode);
    v8_runtime.registerHostFn("__mesh_edit_mirror", hostMeshEditMirror);
    v8_runtime.registerHostFn("__mesh_edit_pick", hostMeshEditPick);
    v8_runtime.registerHostFn("__mesh_edit_clear", hostMeshEditClear);
    v8_runtime.registerHostFn("__mesh_edit_box", hostMeshEditBox);
    v8_runtime.registerHostFn("__mesh_edit_capture", hostMeshEditCapture);
    v8_runtime.registerHostFn("__mesh_edit_focus", hostMeshEditFocus);
    v8_runtime.registerHostFn("__mesh_gizmo_tool", hostMeshGizmoTool);
    v8_runtime.registerHostFn("__mesh_gizmo_nudge", hostMeshGizmoNudge);
    v8_runtime.registerHostFn("__mesh_gizmo_scale_by", hostMeshGizmoScaleBy);
    v8_runtime.registerHostFn("__mesh_topo_extrude_edge", hostMeshTopoExtrudeEdge);
    v8_runtime.registerHostFn("__mesh_topo_extrude_face", hostMeshTopoExtrudeFace);
    v8_runtime.registerHostFn("__mesh_topo_create_face", hostMeshTopoCreateFace);
    v8_runtime.registerHostFn("__mesh_topo_flip_faces", hostMeshTopoFlipFaces);
    v8_runtime.registerHostFn("__mesh_topo_weld", hostMeshTopoWeld);
    v8_runtime.registerHostFn("__mesh_topo_loop_cut", hostMeshTopoLoopCut);
    v8_runtime.registerHostFn("__mesh_lc_begin", hostMeshLcBegin);
    v8_runtime.registerHostFn("__mesh_lc_preview", hostMeshLcPreview);
    v8_runtime.registerHostFn("__mesh_lc_end", hostMeshLcEnd);
    v8_runtime.registerHostFn("__mesh_lc_state", hostMeshLcState);
    v8_runtime.registerHostFn("__mesh_delete_selection", hostMeshDeleteSelection);
    v8_runtime.registerHostFn("__mesh_delete_group_range", hostMeshDeleteGroupRange);
    v8_runtime.registerHostFn("__mesh_group_face_count", hostMeshGroupFaceCount);
    v8_runtime.registerHostFn("__mesh_append_group", hostMeshAppendGroup);
    v8_runtime.registerHostFn("__mesh_append_path_plane", hostMeshAppendPathPlane);
    v8_runtime.registerHostFn("__mesh_append_path_edges", hostMeshAppendPathEdges);
    v8_runtime.registerHostFn("__mesh_set_group_hidden", hostMeshSetGroupHidden);
    v8_runtime.registerHostFn("__mesh_undo", hostMeshUndo);
    v8_runtime.registerHostFn("__mesh_redo", hostMeshRedo);
    v8_runtime.registerHostFn("__mesh_history", hostMeshHistory);
    v8_runtime.registerHostFn("__mesh_history_log", hostMeshHistoryLog);
    v8_runtime.registerHostFn("__mesh_action_source", hostMeshActionSource);
    v8_runtime.registerHostFn("__mesh_action_document", hostMeshActionDocument);
    v8_runtime.registerHostFn("__mesh_action_drain", hostMeshActionDrain);
    v8_runtime.registerHostFn("__mesh_journal_note", hostMeshJournalNote);
    v8_runtime.registerHostFn("__mesh_journal_checkpoint", hostMeshJournalCheckpoint);
    v8_runtime.registerHostFn("__mesh_duplicate_range", hostMeshDuplicateRange);
    v8_runtime.registerHostFn("__mesh_path_array", hostMeshPathArray);
    v8_runtime.registerHostFn("__mesh_path_array_points", hostMeshPathArrayPoints);
    v8_runtime.registerHostFn("__mesh_path_array_spans", hostMeshPathArraySpans);
    v8_runtime.registerHostFn("__mesh_topo_detach", hostMeshTopoDetach);
    v8_runtime.registerHostFn("__mesh_merge_parts", hostMeshMergeParts);
    v8_runtime.registerHostFn("__mesh_topo_merge_faces", hostMeshTopoMergeFaces);
    v8_runtime.registerHostFn("__mesh_topo_glass", hostMeshTopoGlass);
    v8_runtime.registerHostFn("__model_glass_restore", hostModelGlassRestore);
    v8_runtime.registerHostFn("__mesh_topo_solidify", hostMeshTopoSolidify);
    v8_runtime.registerHostFn("__mesh_append_file", hostMeshAppendFile);
    v8_runtime.registerHostFn("__mesh_surviving_groups", hostMeshSurvivingGroups);
    v8_runtime.registerHostFn("__mesh_edit_snapshot", hostMeshEditSnapshot);
    v8_runtime.registerHostFn("__mesh_edit_revert", hostMeshEditRevert);
    v8_runtime.registerHostFn("__mesh_edit_select_face", hostMeshEditSelectFace);
    v8_runtime.registerHostFn("__mesh_edit_select_uv_orientation", hostMeshEditSelectUvOrientation);
    v8_runtime.registerHostFn("__mesh_edit_select_group_range", hostMeshEditSelectGroupRange);
    v8_runtime.registerHostFn("__mesh_edit_scope", hostMeshEditScope);
    v8_runtime.registerHostFn("__mesh_edit_scope_ranges", hostMeshEditScopeRanges);
    v8_runtime.registerHostFn("__mesh_paint_session", hostMeshPaintSession);
    v8_runtime.registerHostFn("__model_paint_layout_stale", hostModelPaintLayoutStale);
    v8_runtime.registerHostFn("__model_paint_layout_invalidate", hostModelPaintLayoutInvalidate);
    v8_runtime.registerHostFn("__mesh_paint_stroke_end", hostMeshPaintStrokeEnd);
    v8_runtime.registerHostFn("__mesh_paint_undo", hostMeshPaintUndo);
    v8_runtime.registerHostFn("__mesh_paint_redo", hostMeshPaintRedo);
    v8_runtime.registerHostFn("__mesh_paint_history", hostMeshPaintHistory);
    v8_runtime.registerHostFn("__mesh_paint_layers", hostMeshPaintLayers);
    v8_runtime.registerHostFn("__mesh_paint_layer_op", hostMeshPaintLayerOp);
    v8_runtime.registerHostFn("__mesh_set_part_ranges", hostMeshSetPartRanges);
    v8_runtime.registerHostFn("__mesh_part_ranges", hostMeshPartRanges);
    v8_runtime.registerHostFn("__model_paint_group_range", hostModelPaintGroupRange);
    v8_runtime.registerHostFn("__mesh_edit_select_edge", hostMeshEditSelectEdge);
    v8_runtime.registerHostFn("__mesh_edit_guard", hostMeshEditGuard);
    v8_runtime.registerHostFn("__mesh_edit_guard_resolve", hostMeshEditGuardResolve);
    v8_runtime.registerHostFn("__mesh_symmetry_report", hostMeshSymmetryReport);
    v8_runtime.registerHostFn("__mesh_symmetrize", hostMeshSymmetrize);
    v8_runtime.registerHostFn("__mesh_edit_counts", hostMeshEditCounts);
    v8_runtime.registerHostFn("__model_paint_at", hostModelPaintAt);
    v8_runtime.registerHostFn("__model_paint_face", hostModelPaintFace);
    v8_runtime.registerHostFn("__model_paint_mode", hostModelPaintMode);
    v8_runtime.registerHostFn("__model_paint_stroke_begin", hostModelPaintStrokeBegin);
    v8_runtime.registerHostFn("__model_paint_stamp", hostModelPaintStamp);
    v8_runtime.registerHostFn("__model_paint_polygon", hostModelPaintPolygon);
    v8_runtime.registerHostFn("__model_paint_material", hostModelPaintMaterial);
    v8_runtime.registerHostFn("__model_paint_material_clear", hostModelPaintMaterialClear);
    v8_runtime.registerHostFn("__model_region_formula", hostModelRegionFormula);
    v8_runtime.registerHostFn("__model_region_set", hostModelRegionSet);
    v8_runtime.registerHostFn("__model_region_bind_slot", hostModelRegionBindSlot);
    v8_runtime.registerHostFn("__model_region_clear", hostModelRegionClear);
    v8_runtime.registerHostFn("__model_set_paint_detail", hostModelSetPaintDetail);
    v8_runtime.registerHostFn("__model_set_paint_fit", hostModelSetPaintFit);
    v8_runtime.registerHostFn("__model_paint_atlas_estimate", hostModelPaintAtlasEstimate);
    v8_runtime.registerHostFn("__model_paint_fit_estimate", hostModelPaintFitEstimate);
    v8_runtime.registerHostFn("__model_atlas_read", hostModelAtlasRead);
    v8_runtime.registerHostFn("__model_uv_layout_apply", hostModelUvLayoutApply);
    v8_runtime.registerHostFn("__model_uv_geometry_apply", hostModelUvGeometryApply);
    v8_runtime.registerHostFn("__model_uv_restore_shape", hostModelUvRestoreShape);
    v8_runtime.registerHostFn("__model_uv_selection_read", hostModelUvSelectionRead);
    v8_runtime.registerHostFn("__model_uv_island_select", hostModelUvIslandSelect);
    v8_runtime.registerHostFn("__model_atlas_replace", hostModelAtlasReplace);
    v8_runtime.registerHostFn("__model_atlas_import", hostModelAtlasImport);
    v8_runtime.registerHostFn("__model_paint_sample", hostModelPaintSample);
    v8_runtime.registerHostFn("__model_atlas_palette", hostModelAtlasPalette);
    v8_runtime.registerHostFn("__image_write_png", hostImageWritePng);
    v8_runtime.registerHostFn("__model_mesh_write", hostModelMeshWrite);
    v8_runtime.registerHostFn("__model_painted_mesh_write", hostModelPaintedMeshWrite);
    v8_runtime.registerHostFn("__model_meshdoc_write", hostModelMeshdocWrite);
    v8_runtime.registerHostFn("__model_atlas_base", hostModelAtlasBase);
    v8_runtime.registerHostFn("__model_atlas_apply", hostModelAtlasApply);
    v8_runtime.registerHostFn("__model_paint_program_read", hostModelPaintProgramRead);
    v8_runtime.registerHostFn("__model_paint_baseline_read", hostModelPaintBaselineRead);
    v8_runtime.registerHostFn("__model_paint_program_apply", hostModelPaintProgramApply);
    v8_runtime.registerHostFn("__model_paint_program_apply_over_base", hostModelPaintProgramApplyOverBase);
    v8_runtime.registerHostFn("__model_face_count", hostModelFaceCount);
    v8_runtime.registerHostFn("__model_set_quality", hostModelSetQuality);
    v8_runtime.registerHostFn("__file_sha256", hostFileSha256);
    v8_runtime.registerHostFn("__hostReleaseFileBuffer", hostReleaseFileBuffer);
    v8_runtime.registerHostFn("__hostLog", hostLog);
    v8_runtime.registerHostFn("__js_eval", hostJsEval);
    v8_runtime.registerHostFn("__latchSet", hostLatchSet);
    v8_runtime.registerHostFn("__latchGet", hostLatchGet);
    v8_runtime.registerHostFn("__anim_register", hostAnimRegister);
    v8_runtime.registerHostFn("__anim_unregister", hostAnimUnregister);
    v8_runtime.registerHostFn("getMouseX", hostGetMouseX);
    v8_runtime.registerHostFn("getMouseY", hostGetMouseY);
    v8_runtime.registerHostFn("getMouseDown", hostGetMouseDown);
    v8_runtime.registerHostFn("getMouseMods", hostGetMouseMods);
    v8_runtime.registerHostFn("getMouseRightDown", hostGetMouseRightDown);
    v8_runtime.registerHostFn("getMouseButtons", hostGetMouseButtons);
    v8_runtime.registerHostFn("getPointerDevice", hostGetPointerDevice);
    v8_runtime.registerHostFn("getPenPressure", hostGetPenPressure);
    v8_runtime.registerHostFn("__mouse_capture", hostMouseCapture);
    v8_runtime.registerHostFn("__mouse_delta", hostMouseDelta);
    v8_runtime.registerHostFn("__input_unfocus", hostInputUnfocus);
    v8_runtime.registerHostFn("__viewport_width", hostViewportWidth);
    v8_runtime.registerHostFn("__viewport_height", hostViewportHeight);
    v8_runtime.registerHostFn("isKeyDown", hostIsKeyDown);
    v8_runtime.registerHostFn("getInputText", hostGetInputText);
    v8_runtime.registerHostFn("__setInputText", hostSetInputText);
    v8_runtime.registerHostFn("__pollInputSubmit", hostPollInputSubmit);
    v8_runtime.registerHostFn("__getPreparedRightClick", hostGetPreparedRightClick);
    v8_runtime.registerHostFn("__getPreparedScroll", hostGetPreparedScroll);
    v8_runtime.registerHostFn("__clipboard_set", hostClipboardSet);
    v8_runtime.registerHostFn("__clipboard_get", hostClipboardGet);
    v8_runtime.registerHostFn("__selection_get", hostSelectionGet);
    v8_runtime.registerHostFn("__selection_clear", hostSelectionClear);
    v8_runtime.registerHostFn("__sys_drop_path", hostSysDropPath);
    v8_runtime.registerHostFn("__sys_selection_get", hostSysSelectionGet);
    v8_runtime.registerHostFn("__exec_async", hostExecAsync);
    v8_runtime.registerHostFn("__routerInit", hostRouterInit);
    v8_runtime.registerHostFn("__routerPush", hostRouterPush);
    v8_runtime.registerHostFn("__routerReplace", hostRouterReplace);
    v8_runtime.registerHostFn("__routerBack", hostRouterBack);
    v8_runtime.registerHostFn("__routerForward", hostRouterForward);
    v8_runtime.registerHostFn("__routerCurrentPath", hostRouterCurrentPath);
    // snake_case aliases — match QJS surface so carts work under both runtimes.
    v8_runtime.registerHostFn("__filedropLastPath", hostFiledropLastPath);
    v8_runtime.registerHostFn("__filedropSeq", hostFiledropSeq);
    v8_runtime.registerHostFn("__localstoreGet", hostLocalstoreGet);
    v8_runtime.registerHostFn("__localstoreHas", hostLocalstoreHas);
    v8_runtime.registerHostFn("__localstoreSet", hostLocalstoreSet);
    v8_runtime.registerHostFn("__localstoreDelete", hostLocalstoreDelete);
    v8_runtime.registerHostFn("__localstoreClear", hostLocalstoreClear);
    v8_runtime.registerHostFn("__localstoreKeysJson", hostLocalstoreKeysJson);
    v8_runtime.registerHostFn("__fswatchAdd", hostFswatchAdd);
    v8_runtime.registerHostFn("__fswatchRemove", hostFswatchRemove);
    v8_runtime.registerHostFn("__fswatchDrain", hostFswatchDrain);
}

fn hostGetInputText(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setReturnString(info, "");
        return;
    }
    const id = argToI32(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    const text = input.getText(@intCast(@max(0, id)));
    setReturnString(info, text);
}

fn hostSetInputText(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = argToI32(info, 0) orelse return;
    if (id < 0) {
        input.setText(0, "");
        return;
    }
    const s = argToStringAlloc(info, 1) orelse {
        input.setText(@intCast(id), "");
        return;
    };
    defer std.heap.c_allocator.free(s);
    input.setText(@intCast(id), s);
}
