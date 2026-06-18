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
