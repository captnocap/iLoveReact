const std = @import("std");
const v8 = @import("v8");
const build_options = @import("build_options");

comptime {
    _ = @hasDecl(build_options, "is_lib");
}

const v8_runtime = @import("v8_runtime.zig");
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
const mesh_import = @import("world/mesh_import.zig");

// Retained FULL-RES source mesh + its path, so the live quality slider can re-decimate
// from the original at any level (model_set_quality) without re-reading the file.
//
// PAINT IS RESOLUTION-INDEPENDENT: g_source_colors is the authoritative per-face paint
// (at full-res facecount). Whatever quality is displayed, painting a displayed face
// writes back through g_face_to_source (displayed face → source face) into here, and a
// quality change re-derives the displayed colours from here. So paint survives every
// quality change and every LoD is just a projection of this one paint.
var g_source_verts: ?[]f32 = null;
var g_source_count: u32 = 0;
var g_source_path: ?[]u8 = null;
var g_source_colors: ?[]u8 = null; // g_source_count*4 rgba — the authoritative paint
var g_face_to_source: ?[]u32 = null; // current displayed face → source face (identity at full-res)

fn retainSource(path: []const u8, verts: []const f32, count: u32) void {
    if (g_source_verts) |v| std.heap.c_allocator.free(v);
    if (g_source_path) |p| std.heap.c_allocator.free(p);
    if (g_source_colors) |sc| std.heap.c_allocator.free(sc);
    if (g_face_to_source) |m| std.heap.c_allocator.free(m);
    g_source_verts = std.heap.c_allocator.dupe(f32, verts) catch null;
    g_source_path = std.heap.c_allocator.dupe(u8, path) catch null;
    g_source_count = if (g_source_verts != null) count else 0;

    // Fresh paint = all default grey; the displayed mesh starts as the source itself,
    // so the face→source map is the identity.
    const fc = count / 3;
    g_source_colors = std.heap.c_allocator.alloc(u8, @as(usize, fc) * 4) catch null;
    if (g_source_colors) |cols| {
        var i: usize = 0;
        while (i < fc) : (i += 1) {
            cols[i * 4 + 0] = scene3d.DEFAULT_FACE[0];
            cols[i * 4 + 1] = scene3d.DEFAULT_FACE[1];
            cols[i * 4 + 2] = scene3d.DEFAULT_FACE[2];
            cols[i * 4 + 3] = scene3d.DEFAULT_FACE[3];
        }
    }
    g_face_to_source = std.heap.c_allocator.alloc(u32, fc) catch null;
    if (g_face_to_source) |m| {
        var i: u32 = 0;
        while (i < fc) : (i += 1) m[i] = i;
    }
}

/// Replace the current displayed→source face map (taking ownership of a copy of `m`).
fn setFaceMap(m: []const u32) void {
    if (g_face_to_source) |old| std.heap.c_allocator.free(old);
    g_face_to_source = std.heap.c_allocator.dupe(u32, m) catch null;
}

/// Write a painted DISPLAYED face's colour back to the authoritative source paint
/// (displayed face → source face via the current map), so it survives quality changes.
fn writeSourceColor(displayed_face: i32, r: u8, g: u8, b: u8) void {
    if (displayed_face < 0) return;
    const map = g_face_to_source orelse return;
    const cols = g_source_colors orelse return;
    const df: usize = @intCast(displayed_face);
    if (df >= map.len) return;
    const sf = map[df];
    if (@as(usize, sf) * 4 + 3 >= cols.len) return;
    cols[sf * 4 + 0] = r;
    cols[sf * 4 + 1] = g;
    cols[sf * 4 + 2] = b;
    cols[sf * 4 + 3] = 255;
}
const system_signals = @import("ifttt/system_signals.zig");
const selection_watch = @import("ifttt/selection_watch.zig");
const event_bus = @import("diag/event_bus.zig");
const c = @import("engine.zig").c;

var g_content_store: std.AutoHashMap(u32, []u8) = undefined;
var g_content_store_inited: bool = false;
var g_content_store_next_id: u32 = 1;

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
    const data = std.fs.cwd().readFileAlloc(std.heap.c_allocator, path, 64 * 1024 * 1024) catch |e| {
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
    setReturnNumber(info, @floatFromInt(next_id));
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
    setReturnNumber(info, @floatFromInt(next_id));
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

    var mesh = mesh_import.loadFile(std.heap.c_allocator, path) catch |e| {
        std.log.warn("[mesh-load] {s}: {}", .{ path, e });
        setReturnString(info, "");
        return;
    };
    defer mesh.deinit(std.heap.c_allocator);

    // Keep the pristine full-res mesh for the quality slider (before setPaintTarget
    // rewrites UVs — positions are untouched, but copy now to be unambiguous).
    retainSource(path, mesh.verts, mesh.vert_count);

    // Adopt this mesh as the paint target FIRST — it rewrites the verts' UVs to the
    // per-face paint atlas in place, so the stash (next) ships the paint-ready UVs.
    scene3d.setPaintTarget(path, mesh.verts, mesh.vert_count);
    if (!scene3d.stashHostMesh(path, mesh.verts, mesh.vert_count)) {
        setReturnString(info, "");
        return;
    }
    scene3d.orbitFrame(mesh.center, mesh.radius);
    state.markDirty();

    // Build {"key":"<escaped path>","count":N,"radius":R} for the cart to mount.
    var buf: std.ArrayList(u8) = .{};
    defer buf.deinit(std.heap.c_allocator);
    const w = buf.writer(std.heap.c_allocator);
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
    setReturnString(info, buf.items);
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

/// __mesh_edit_mode(m) — set the selection mode: 0 none, 1 vertex, 2 edge, 3 face. The
/// host-native counterpart to the Studio's JS mode toolbar; selection lives in the host.
fn hostMeshEditMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const m: u8 = @intCast(std.math.clamp(argToI32(info, 0) orelse 0, 0, 3));
    scene3d.meshEditSetMode(m);
    state.markDirty();
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
    setReturnNumber(info, @floatFromInt(n));
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
    setReturnNumber(info, @floatFromInt(n));
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
/// resident model and paint the face it hits with (r,g,b). One call covers both
/// gestures: a click fills one face, a drag fires this per move. Returns 1 on a hit
/// (and repaints), 0 on a miss. r/g/b are 0–255.
fn hostModelPaintAt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const x: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 0, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 0, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 4) orelse 0, 0, 255));
    const face = scene3d.paintAt(x, y, r, g, b);
    if (face >= 0) {
        writeSourceColor(face, r, g, b); // keep the source paint authoritative
        state.markDirty();
    }
    setReturnNumber(info, if (face >= 0) 1 else 0);
}

/// __model_paint_face(face, r, g, b) → bool. Fill a face by index (no raycast) —
/// programmatic colouring + the headless paint proof.
fn hostModelPaintFace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const face: u32 = @intCast(@max(0, argToI32(info, 0) orelse 0));
    const r: u8 = @intCast(std.math.clamp(argToI32(info, 1) orelse 0, 0, 255));
    const g: u8 = @intCast(std.math.clamp(argToI32(info, 2) orelse 0, 0, 255));
    const b: u8 = @intCast(std.math.clamp(argToI32(info, 3) orelse 0, 0, 255));
    const ok = scene3d.paintFaceByIndex(face, r, g, b);
    if (ok) {
        writeSourceColor(@intCast(face), r, g, b); // source-authoritative, like paint_at
        state.markDirty();
    }
    setReturnNumber(info, if (ok) 1 else 0);
}

/// __model_face_count() → number of triangles in the active paint target (0 if none).
fn hostModelFaceCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(scene3d.paintFaceCount()));
}

/// __file_sha256(path) → 64-char lowercase hex of the file's bytes, or "" on read
/// failure. Content-addresses an imported asset so its attribution follows the BYTES,
/// not the filename — a renamed or re-downloaded copy resolves to the same entry.
fn hostFileSha256(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(path);
    const data = std.fs.cwd().readFileAlloc(std.heap.c_allocator, path, 512 * 1024 * 1024) catch {
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
/// return it for the cart to mount. The camera is left alone (no re-frame) so the model
/// doesn't jump while you scrub. Resets paint (the topology changed).
fn hostModelSetQuality(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const grid: u32 = @intCast(std.math.clamp(argToI32(info, 0) orelse 64, 2, 1024));
    const src = g_source_verts orelse {
        setReturnString(info, "");
        return;
    };
    const base = g_source_path orelse "model";

    var dec = mesh_import.decimateExpanded(std.heap.c_allocator, src, g_source_count, grid) catch {
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

    scene3d.setPaintTarget(key, dec.mesh.verts, dec.mesh.vert_count);
    if (!scene3d.stashHostMesh(key, dec.mesh.verts, dec.mesh.vert_count)) {
        setReturnString(info, "");
        return;
    }

    // Carry the authoritative source paint down onto this level: each new face takes the
    // colour of the source face it came from. So lowering quality keeps your paint.
    if (g_source_colors) |src_cols| {
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
    setFaceMap(dec.face_to_source);
    state.markDirty();

    var buf: std.ArrayList(u8) = .{};
    defer buf.deinit(std.heap.c_allocator);
    const w = buf.writer(std.heap.c_allocator);
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
    setReturnString(info, buf.items);
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
        break :blk @intFromFloat(v);
    };

    const curve = animations.CurveType.fromString(curve_name);
    const loop: animations.LoopMode = blk: {
        if (std.mem.eql(u8, loop_name, "once")) break :blk .once;
        if (std.mem.eql(u8, loop_name, "pingpong")) break :blk .pingpong;
        break :blk .cycle;
    };
    const now_ms: i64 = @as(i64, @truncate(@divFloor(std.time.nanoTimestamp(), 1_000_000)));
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
    setReturnNumber(info, @floatFromInt(id));
}

fn hostAnimUnregister(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const id_f = argToF64(info, 0) orelse return;
    const id: u32 = @intFromFloat(id_f);
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

fn hostGetMouseRightDown(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (mouse_state.g_mouse_right_down) 1 else 0);
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
    objectSetNumber(obj, ctx, "id", @floatFromInt(evt.id));
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

// Async exec — __exec_async(cmd, rid). Spawns a detached thread that runs the
// command via popen; result is drained by execTickDrain() and delivered to JS
// via __ffiEmit('exec:<rid>', JSON.stringify({stdout, code})).
fn hostExecAsync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const cmd = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(cmd);
    const rid = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(rid);
    exec_async.spawn(rid, cmd);
}

fn emitExecResult(rid: []const u8, stdout: []const u8, code: i32) void {
    // Build JSON payload. Only escape the couple of chars we need for stdout;
    // stdout can be arbitrary text with quotes/newlines/backslashes.
    var buf: std.ArrayList(u8) = .{};
    defer buf.deinit(std.heap.c_allocator);
    const w = buf.writer(std.heap.c_allocator);
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
    const payload = buf.items;

    // Build channel string "exec:<rid>" nul-terminated for callGlobal2Str.
    var chan: std.ArrayList(u8) = .{};
    defer chan.deinit(std.heap.c_allocator);
    chan.appendSlice(std.heap.c_allocator, "exec:") catch return;
    chan.appendSlice(std.heap.c_allocator, rid) catch return;
    chan.append(std.heap.c_allocator, 0) catch return;
    const chan_z = chan.items[0 .. chan.items.len - 1 :0];

    var payload_arr: std.ArrayList(u8) = .{};
    defer payload_arr.deinit(std.heap.c_allocator);
    payload_arr.appendSlice(std.heap.c_allocator, payload) catch return;
    payload_arr.append(std.heap.c_allocator, 0) catch return;
    const payload_z = payload_arr.items[0 .. payload_arr.items.len - 1 :0];

    v8_runtime.callGlobal2Str("__ffiEmit", chan_z, payload_z);
}

/// Per-frame drain. Currently emits results from completed async exec calls
/// to JS via __ffiEmit (the listener path defers through setTimeout, so the
/// listener actually runs on the *next* __jsTick — no ordering dependency
/// vs __jsTick itself). Renamed from execTickDrain to fit the uniform
/// tickDrain() name that INGREDIENTS in v8_app.zig expects.
pub fn tickDrain() void {
    exec_async.drain(emitExecResult);
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
    const value = localstore.getAlloc(std.heap.c_allocator, ns, key) catch {
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
    const found = localstore.has(ns, key) catch {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (found) 1 else 0);
}

fn hostLocalstoreSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(key);
    const value = argToStringAlloc(info, 2) orelse return;
    defer std.heap.c_allocator.free(value);
    localstore.set(ns, key, value) catch |err| {
        // a swallowed set is invisible data loss (the 8KB-cap bug hid behind
        // exactly this catch) — fail loud on stderr
        std.debug.print("[localstore] SET FAILED ns={s} key={s} len={d}: {s}\n", .{ ns, key, value.len, @errorName(err) });
    };
}

fn hostLocalstoreDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(key);
    localstore.delete(ns, key) catch {};
}

fn hostLocalstoreClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        localstore.clear(null) catch {};
        return;
    }
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    if (ns.len == 0) {
        localstore.clear(null) catch {};
    } else {
        localstore.clear(ns) catch {};
    }
}

fn hostLocalstoreKeysJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ns = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "[]");
        return;
    };
    defer std.heap.c_allocator.free(ns);

    var entries: [localstore.MAX_KEYS]localstore.KeyEntry = undefined;
    const count = localstore.keys(ns, &entries) catch {
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

    const id = fswatch.addWatcher(.{
        .path = path,
        .recursive = recursive,
        .interval_ms = interval_ms,
        .pattern = if (pat_owned) |p| if (p.len > 0) p else null else null,
    }) catch {
        setReturnNumber(info, -1);
        return;
    };
    setReturnNumber(info, @floatFromInt(id));
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

pub fn registerCore(vm: anytype) void {
    _ = vm;
    ensureContentStore();
    // __hostFlush is registered by framework/v8_bindings_reconciler.zig
    // (the shell calls reconciler.register() directly).
    v8_runtime.registerHostFn("__getInputTextForNode", hostGetInputTextForNode);
    v8_runtime.registerHostFn("__hostLoadFileToBuffer", hostLoadFileToBuffer);
    v8_runtime.registerHostFn("__hostUploadFloatBuffer", hostUploadFloatBuffer);
    v8_runtime.registerHostFn("__scene3d_patch_dyn", hostScene3DPatchDyn);
    v8_runtime.registerHostFn("__mesh_load_file", hostMeshLoadFile);
    v8_runtime.registerHostFn("__model_orbit_drag", hostModelOrbitDrag);
    v8_runtime.registerHostFn("__model_orbit_zoom", hostModelOrbitZoom);
    v8_runtime.registerHostFn("__model_orbit_pan", hostModelOrbitPan);
    v8_runtime.registerHostFn("__model_focus_at", hostModelFocusAt);
    v8_runtime.registerHostFn("__mesh_edit_mode", hostMeshEditMode);
    v8_runtime.registerHostFn("__mesh_edit_pick", hostMeshEditPick);
    v8_runtime.registerHostFn("__mesh_edit_clear", hostMeshEditClear);
    v8_runtime.registerHostFn("__mesh_edit_box", hostMeshEditBox);
    v8_runtime.registerHostFn("__mesh_edit_snapshot", hostMeshEditSnapshot);
    v8_runtime.registerHostFn("__mesh_edit_revert", hostMeshEditRevert);
    v8_runtime.registerHostFn("__mesh_edit_select_face", hostMeshEditSelectFace);
    v8_runtime.registerHostFn("__mesh_edit_counts", hostMeshEditCounts);
    v8_runtime.registerHostFn("__model_paint_at", hostModelPaintAt);
    v8_runtime.registerHostFn("__model_paint_face", hostModelPaintFace);
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
    v8_runtime.registerHostFn("getMouseRightDown", hostGetMouseRightDown);
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
