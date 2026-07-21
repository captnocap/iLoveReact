const std = @import("std");
const v8 = @import("v8");
const v8rt = @import("v8_runtime.zig");
// Frame telemetry counters — were housed in qjs_runtime.zig, now in
// framework/frame_telemetry.zig (archive/qjs-stack/README.md). Aliased
// as `qjs_runtime` to keep existing call sites working.
const frame_telemetry = @import("diag/frame_telemetry.zig");
const telemetry = @import("diag/telemetry.zig");
const system_memory = @import("diag/system_memory.zig");
const mem_breakdown = @import("diag/mem_breakdown.zig");
const reconciler = @import("v8_bindings_reconciler.zig");
const localstore = @import("storage/localstore.zig");
const hotstate = @import("state/hotstate.zig");
const sqlite_mod = @import("storage/sqlite.zig");
const pty_mod = @import("terminal/pty.zig");
const canvas_mod = @import("primitive/canvas.zig");

const MAX_PTYS: usize = 16;
var g_ptys: [MAX_PTYS]?pty_mod.Pty = .{null} ** MAX_PTYS;
var g_active_pty_handle: u8 = 0;

const LS_NS: []const u8 = "app";
const HTTP_MAX_HEADERS: usize = 16;

fn currentContext(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn retUndefined(info_c: ?*const v8.c.FunctionCallbackInfo) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(info.getIsolate().initUndefined().toValue());
}

fn setNumberReturn(info: v8.FunctionCallbackInfo, n: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initNumber(n).toValue());
}

fn setBoolReturn(info: v8.FunctionCallbackInfo, b: bool) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initBoolean(b));
}

fn setStringReturn(info: v8.FunctionCallbackInfo, s: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initStringUtf8(s).toValue());
}

fn setNullReturn(info: v8.FunctionCallbackInfo) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initNull().toValue());
}

fn setObjectNumber(ctx: v8.Context, obj: v8.Object, key: []const u8, val: anytype) void {
    const iso = ctx.getIsolate();
    const k = iso.initStringUtf8(key);
    const n = iso.initNumber(@floatFromInt(val));
    _ = obj.setValue(ctx, k.toValue(), n.toValue());
}

fn setObjectFloat(ctx: v8.Context, obj: v8.Object, key: []const u8, val: f64) void {
    const iso = ctx.getIsolate();
    const k = iso.initStringUtf8(key);
    const n = iso.initNumber(val);
    _ = obj.setValue(ctx, k.toValue(), n.toValue());
}

fn setObjectBool(ctx: v8.Context, obj: v8.Object, key: []const u8, val: bool) void {
    const iso = ctx.getIsolate();
    const k = iso.initStringUtf8(key);
    const b = iso.initBoolean(val);
    _ = obj.setValue(ctx, k.toValue(), b);
}

fn setObjectString(ctx: v8.Context, obj: v8.Object, key: []const u8, val: []const u8) void {
    const iso = ctx.getIsolate();
    const k = iso.initStringUtf8(key);
    const s = iso.initStringUtf8(val);
    _ = obj.setValue(ctx, k.toValue(), s.toValue());
}

fn argI32(info: v8.FunctionCallbackInfo, idx: u32, default: i32) i32 {
    if (idx >= info.length()) return default;
    const ctx = currentContext(info);
    return info.getArg(idx).toI32(ctx) catch default;
}

fn argU32(info: v8.FunctionCallbackInfo, idx: u32, default: u32) u32 {
    if (idx >= info.length()) return default;
    const ctx = currentContext(info);
    return info.getArg(idx).toU32(ctx) catch default;
}

fn argF64(info: v8.FunctionCallbackInfo, idx: u32, default: f64) f64 {
    if (idx >= info.length()) return default;
    const ctx = currentContext(info);
    return info.getArg(idx).toF64(ctx) catch default;
}

fn argOwnedUtf8(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const n = str.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = str.writeUtf8(iso, buf);
    return buf;
}

fn argOwnedUtf8Z(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[:0]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const n = str.lenUtf8(iso);
    const buf = alloc.allocSentinel(u8, n, 0) catch return null;
    _ = str.writeUtf8(iso, buf[0..n]);
    return buf;
}

fn argJsonString(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    return argOwnedUtf8(alloc, info, idx);
}

fn appendJsonEscaped(out: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |ch| switch (ch) {
        '"' => try out.appendSlice(alloc, "\\\""),
        '\\' => try out.appendSlice(alloc, "\\\\"),
        '\n' => try out.appendSlice(alloc, "\\n"),
        '\r' => try out.appendSlice(alloc, "\\r"),
        '\t' => try out.appendSlice(alloc, "\\t"),
        0...8, 11, 12, 14...31 => {
            var escaped_buf: [6]u8 = undefined;
            const escaped = try std.fmt.bufPrint(&escaped_buf, "\\u{x:0>4}", .{ch});
            try out.appendSlice(alloc, escaped);
        },
        else => try out.append(alloc, ch),
    };
    try out.append(alloc, '"');
}

fn jsValueOrEmptyString(iso: v8.Isolate, s: []const u8) v8.Value {
    return iso.initStringUtf8(s).toValue();
}

fn getFpsCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setNumberReturn(info, frame_telemetry.telemetry_fps);
}

fn getLayoutUsCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setNumberReturn(info, @floatFromInt(frame_telemetry.telemetry_layout_us));
}

fn getPaintUsCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setNumberReturn(info, @floatFromInt(frame_telemetry.telemetry_paint_us));
}

// NOTE: getTickUs was removed 2026-06-25 — it returned `telemetry_tick_us`, the
// duration of the dead QuickJS frame-pump no-op (always 0 under V8). The honest
// per-frame JS measure is `bridge_us` (Zig→JS app-tick + event-dispatch time).

/// Build a JS frame object from a snapshot. Shared by __tel_frame (the latest
/// frame) and __tel_frame_at (a historical frame), so the spikewatch can read
/// the SPIKE frame's latched buckets instead of the recovered current frame's.
fn buildFrameObject(iso: v8.Isolate, ctx: v8.Context, s: telemetry.Snapshot) v8.Object {
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "fps", s.fps);
    setObjectNumber(ctx, obj, "layout_us", s.layout_us);
    setObjectNumber(ctx, obj, "paint_us", s.paint_us);
    setObjectNumber(ctx, obj, "gpu_us", s.gpu_us);
    setObjectNumber(ctx, obj, "frame_total_us", s.frame_total_us);
    setObjectNumber(ctx, obj, "event_us", s.event_us);
    setObjectNumber(ctx, obj, "app_tick_us", s.app_tick_us);
    setObjectNumber(ctx, obj, "pre_layout_us", s.pre_layout_us);
    setObjectNumber(ctx, obj, "pre_paint_us", s.pre_paint_us);
    setObjectNumber(ctx, obj, "post_frame_us", s.post_frame_us);
    // Outside-render attribution (measured at real boundaries) — the spikewatch
    // reads these to name the ONE cause that fired instead of guessing. gc_ns is
    // nanoseconds (sub-µs honest); gc_count disambiguates a zero from "dead".
    setObjectNumber(ctx, obj, "gc_ns", s.gc_ns);
    setObjectNumber(ctx, obj, "gc_count", s.gc_count);
    setObjectNumber(ctx, obj, "gc_type", s.gc_type);
    setObjectNumber(ctx, obj, "present_us", s.present_us);
    setObjectNumber(ctx, obj, "bridge_us", s.bridge_us);
    setObjectNumber(ctx, obj, "frame_number", s.frame_number);
    setObjectNumber(ctx, obj, "bridge_calls_per_sec", s.bridge_calls_per_sec);
    return obj;
}

fn telFrameCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const obj = buildFrameObject(iso, ctx, telemetry.current);
    info.getReturnValue().set(obj.toValue());
}

/// __tel_frame_at(n) — the full frame object for history depth n (0 = current,
/// newest first), matching __tel_history's indexing. Returns null past the ring.
/// This is the GAP-2 fix: the spikewatch finds the worst frame in the tape, then
/// reads THAT frame's latched buckets here instead of the post-recovery frame.
fn telFrameAtCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const n: usize = if (info.length() >= 1) @intCast(@max(0, argI32(info, 0, 0))) else 0;
    if (telemetry.getHistory(n)) |snap| {
        const obj = buildFrameObject(iso, ctx, snap.*);
        info.getReturnValue().set(obj.toValue());
    } else {
        info.getReturnValue().set(iso.initNull().toValue());
    }
}

fn telHostFlushCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = reconciler.telemetrySnapshot();
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "queued_batches", s.queued_batches);
    setObjectNumber(ctx, obj, "queued_bytes", s.queued_bytes);
    setObjectNumber(ctx, obj, "last_drain_batches", s.last_drain_batches);
    setObjectNumber(ctx, obj, "last_drain_bytes", s.last_drain_bytes);
    setObjectNumber(ctx, obj, "last_drain_us", s.last_drain_us);
    setObjectNumber(ctx, obj, "total_enqueued_batches", s.total_enqueued_batches);
    setObjectNumber(ctx, obj, "total_enqueued_bytes", s.total_enqueued_bytes);
    setObjectNumber(ctx, obj, "total_drained_batches", s.total_drained_batches);
    setObjectNumber(ctx, obj, "total_drained_bytes", s.total_drained_bytes);
    info.getReturnValue().set(obj.toValue());
}

fn telGpuCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = telemetry.current;
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "rect_count", s.rect_count);
    setObjectNumber(ctx, obj, "glyph_count", s.glyph_count);
    setObjectNumber(ctx, obj, "rect_capacity", s.rect_capacity);
    setObjectNumber(ctx, obj, "glyph_capacity", s.glyph_capacity);
    setObjectNumber(ctx, obj, "atlas_glyph_count", s.atlas_glyph_count);
    setObjectNumber(ctx, obj, "atlas_miss_count", s.atlas_miss_count);
    setObjectNumber(ctx, obj, "atlas_capacity", s.atlas_capacity);
    setObjectNumber(ctx, obj, "atlas_row_x", s.atlas_row_x);
    setObjectNumber(ctx, obj, "atlas_row_y", s.atlas_row_y);
    setObjectNumber(ctx, obj, "scissor_depth", s.scissor_depth);
    setObjectNumber(ctx, obj, "scissor_segment_count", s.scissor_segment_count);
    setObjectNumber(ctx, obj, "gpu_surface_w", s.gpu_surface_w);
    setObjectNumber(ctx, obj, "gpu_surface_h", s.gpu_surface_h);
    setObjectNumber(ctx, obj, "frame_hash", s.frame_hash);
    setObjectNumber(ctx, obj, "rect_hash", s.rect_hash);
    setObjectNumber(ctx, obj, "text_hash", s.text_hash);
    setObjectNumber(ctx, obj, "curves_hash", s.curves_hash);
    setObjectNumber(ctx, obj, "capsules_hash", s.capsules_hash);
    setObjectNumber(ctx, obj, "polys_hash", s.polys_hash);
    setObjectString(ctx, obj, "text_trace", s.text_trace);
    setObjectNumber(ctx, obj, "static_capture_count", s.static_capture_count);
    setObjectString(ctx, obj, "static_capture_trace", s.static_capture_trace);
    setObjectNumber(ctx, obj, "frames_since_drain", s.frames_since_drain);
    setObjectNumber(ctx, obj, "scene3d_scene_count", s.scene3d_scene_count);
    setObjectNumber(ctx, obj, "scene3d_mesh_children", s.scene3d_mesh_children);
    setObjectNumber(ctx, obj, "scene3d_meshes_collected", s.scene3d_meshes_collected);
    setObjectNumber(ctx, obj, "scene3d_meshes_dropped", s.scene3d_meshes_dropped);
    setObjectNumber(ctx, obj, "scene3d_instances", s.scene3d_instances);
    setObjectNumber(ctx, obj, "scene3d_draw_calls", s.scene3d_draw_calls);
    setObjectNumber(ctx, obj, "scene3d_triangles", s.scene3d_triangles);
    setObjectNumber(ctx, obj, "scene3d_draw_us", s.scene3d_draw_us);
    info.getReturnValue().set(obj.toValue());
}

fn telNodesCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = telemetry.current;
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "total", s.total_nodes);
    setObjectNumber(ctx, obj, "visible", s.visible_nodes);
    setObjectNumber(ctx, obj, "hidden", s.hidden_nodes);
    setObjectNumber(ctx, obj, "zero_size", s.zero_size_nodes);
    setObjectNumber(ctx, obj, "max_depth", s.max_depth);
    setObjectNumber(ctx, obj, "scroll", s.scroll_nodes);
    setObjectNumber(ctx, obj, "text", s.text_nodes);
    setObjectNumber(ctx, obj, "image", s.image_nodes);
    setObjectNumber(ctx, obj, "pressable", s.pressable_nodes);
    setObjectNumber(ctx, obj, "canvas", s.canvas_nodes);
    info.getReturnValue().set(obj.toValue());
}

fn telSystemCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const io = v8rt.hostContext(iso).io;
    const ctx = iso.getCurrentContext();
    const s = telemetry.current;
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "window_x", s.window_x);
    setObjectNumber(ctx, obj, "window_y", s.window_y);
    setObjectNumber(ctx, obj, "window_w", s.window_w);
    setObjectNumber(ctx, obj, "window_h", s.window_h);
    setObjectNumber(ctx, obj, "display_count", s.display_count);
    setObjectNumber(ctx, obj, "current_display", s.current_display);
    setObjectNumber(ctx, obj, "display_w", s.display_w);
    setObjectNumber(ctx, obj, "display_h", s.display_h);
    setObjectNumber(ctx, obj, "breakpoint", s.breakpoint_tier);
    setObjectNumber(ctx, obj, "secondary_windows", s.secondary_window_count);
    const mem = system_memory.readSnapshot(io);
    const mappings = system_memory.readMappingRss(io);
    setObjectNumber(ctx, obj, "process_rss_bytes", mem.process_rss_bytes);
    setObjectNumber(ctx, obj, "process_rss_peak_bytes", mem.process_rss_peak_bytes);
    setObjectNumber(ctx, obj, "process_rss_anon_bytes", mem.process_rss_anon_bytes);
    setObjectNumber(ctx, obj, "process_rss_file_bytes", mem.process_rss_file_bytes);
    setObjectNumber(ctx, obj, "process_rss_shmem_bytes", mem.process_rss_shmem_bytes);
    setObjectNumber(ctx, obj, "process_vsize_bytes", mem.process_vsize_bytes);
    setObjectNumber(ctx, obj, "process_vsize_peak_bytes", mem.process_vsize_peak_bytes);
    setObjectNumber(ctx, obj, "process_vm_data_bytes", mem.process_vm_data_bytes);
    setObjectNumber(ctx, obj, "process_vm_stack_bytes", mem.process_vm_stack_bytes);
    setObjectNumber(ctx, obj, "process_vm_exe_bytes", mem.process_vm_exe_bytes);
    setObjectNumber(ctx, obj, "process_vm_lib_bytes", mem.process_vm_lib_bytes);
    setObjectNumber(ctx, obj, "process_vm_swap_bytes", mem.process_vm_swap_bytes);
    setObjectNumber(ctx, obj, "process_threads", mem.process_threads);
    setObjectNumber(ctx, obj, "process_map_heap_rss_bytes", mappings.heap_bytes);
    setObjectNumber(ctx, obj, "process_map_anonymous_rss_bytes", mappings.anonymous_bytes);
    setObjectNumber(ctx, obj, "process_map_file_rss_bytes", mappings.file_bytes);
    setObjectNumber(ctx, obj, "process_map_stack_rss_bytes", mappings.stack_bytes);
    setObjectNumber(ctx, obj, "process_map_special_rss_bytes", mappings.special_bytes);
    setObjectNumber(ctx, obj, "process_map_total_rss_bytes", mappings.total_bytes);
    setObjectNumber(ctx, obj, "process_map_count", mappings.mapping_count);
    setObjectBool(ctx, obj, "process_map_complete", mappings.complete);
    setObjectNumber(ctx, obj, "mem_total_bytes", mem.total_bytes);
    setObjectNumber(ctx, obj, "mem_available_bytes", mem.available_bytes);
    // Per-subsystem attribution (mem_breakdown.zig). GPU fields describe owned
    // device buffers; js_*/host_* fields describe process allocations. Reserved
    // capacity is exposed separately from logical use so the cart never treats
    // untouched address space as RSS.
    const mb = mem_breakdown.read();
    setObjectNumber(ctx, obj, "gpu_geom_intern_bytes", mb.geom_intern_bytes);
    setObjectNumber(ctx, obj, "gpu_glyph_atlas_bytes", mb.glyph_atlas_bytes);
    setObjectNumber(ctx, obj, "gpu_glyph_buffer_bytes", mb.glyph_buffer_bytes);
    setObjectNumber(ctx, obj, "gpu_ui_rect_bytes", mb.ui_rect_bytes);
    setObjectNumber(ctx, obj, "gpu_paint_texture_bytes", mb.paint_texture_bytes);
    setObjectNumber(ctx, obj, "gpu_map_static_instances_used_bytes", mb.gpu_map_static_instances_used_bytes);
    setObjectNumber(ctx, obj, "gpu_map_static_instances_capacity_bytes", mb.gpu_map_static_instances_capacity_bytes);
    setObjectNumber(ctx, obj, "gpu_map_slim_instances_used_bytes", mb.gpu_map_slim_instances_used_bytes);
    setObjectNumber(ctx, obj, "gpu_map_slim_instances_capacity_bytes", mb.gpu_map_slim_instances_capacity_bytes);
    setObjectNumber(ctx, obj, "gpu_render3d_core_capacity_bytes", mb.gpu_render3d_core_capacity_bytes);
    setObjectNumber(ctx, obj, "gpu_render3d_target_bytes", mb.gpu_render3d_target_bytes);
    setObjectNumber(ctx, obj, "gpu_render3d_diffuse_texture_bytes", mb.gpu_render3d_diffuse_texture_bytes);
    setObjectNumber(ctx, obj, "js_heap_used_bytes", mb.js_heap_used_bytes);
    setObjectNumber(ctx, obj, "js_heap_total_bytes", mb.js_heap_total_bytes);
    setObjectNumber(ctx, obj, "js_external_bytes", mb.js_external_bytes);
    setObjectNumber(ctx, obj, "js_malloced_bytes", mb.js_malloced_bytes);
    setObjectNumber(ctx, obj, "host_mesh_stash_bytes", mb.host_mesh_stash_bytes);
    setObjectNumber(ctx, obj, "host_map_chunks_bytes", mb.host_map_chunks_bytes);
    setObjectNumber(ctx, obj, "host_map_foliage_rows_used_bytes", mb.host_map_foliage_rows_used_bytes);
    setObjectNumber(ctx, obj, "host_map_foliage_rows_capacity_bytes", mb.host_map_foliage_rows_capacity_bytes);
    setObjectNumber(ctx, obj, "host_map_foliage_snapshot_bytes", mb.host_map_foliage_snapshot_bytes);
    setObjectNumber(ctx, obj, "host_map_paint_residency_bytes", mb.host_map_paint_residency_bytes);
    setObjectNumber(ctx, obj, "host_map_roads_bytes", mb.host_map_roads_bytes);
    setObjectNumber(ctx, obj, "host_map_history_bytes", mb.host_map_history_bytes);
    setObjectNumber(ctx, obj, "host_libc_in_use_bytes", mb.host_libc_in_use_bytes);
    setObjectNumber(ctx, obj, "host_libc_arena_bytes", mb.host_libc_arena_bytes);
    setObjectNumber(ctx, obj, "host_libc_mmap_bytes", mb.host_libc_mmap_bytes);
    setObjectNumber(ctx, obj, "host_libc_free_bytes", mb.host_libc_free_bytes);
    setObjectNumber(ctx, obj, "host_libc_releasable_bytes", mb.host_libc_releasable_bytes);
    setObjectNumber(ctx, obj, "shader_compile_count", mb.shader_compile_count);
    setObjectNumber(ctx, obj, "shader_compile_last_peak_growth_bytes", mb.shader_compile_last_peak_growth_bytes);
    setObjectNumber(ctx, obj, "shader_compile_last_retained_growth_bytes", mb.shader_compile_last_retained_growth_bytes);
    setObjectNumber(ctx, obj, "shader_compile_last_trim_released_bytes", mb.shader_compile_last_trim_released_bytes);
    info.getReturnValue().set(obj.toValue());
}

fn telInputCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = telemetry.current;
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "focused_id", s.focused_input_id);
    setObjectNumber(ctx, obj, "active_count", s.active_input_count);
    setObjectBool(ctx, obj, "has_selection", s.has_selection);
    setObjectBool(ctx, obj, "selection_dragging", s.selection_dragging);
    setObjectBool(ctx, obj, "tooltip_visible", s.tooltip_visible);
    info.getReturnValue().set(obj.toValue());
}

fn telCanvasCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = telemetry.current;
    const obj = iso.initObject();
    setObjectFloat(ctx, obj, "cam_x", s.canvas_cam_x);
    setObjectFloat(ctx, obj, "cam_y", s.canvas_cam_y);
    setObjectFloat(ctx, obj, "cam_zoom", s.canvas_cam_zoom);
    setObjectNumber(ctx, obj, "type_count", s.canvas_type_count);
    info.getReturnValue().set(obj.toValue());
}

// Convert a screen-space pixel (e.g. mouse event coords) into the active
// Canvas's world-space (gx/gy) coordinates. Mirrors the Zig-side
// canvas.screenToGraphFor() so cart code can paint/hit-test inside a
// <Canvas> regardless of its current pan/zoom.
//
// Args: (screen_x, screen_y, vp_cx, vp_cy [, canvas_id=0])
//   vp_cx/vp_cy = center of the canvas's screen rect (cart computes
//   this from onLayout: vp_cx = rect.x + rect.width/2, etc.)
//
// Returns: { gx: number, gy: number }
fn canvasScreenToGraphCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const sx: f32 = @floatCast(argF64(info, 0, 0));
    const sy: f32 = @floatCast(argF64(info, 1, 0));
    const vpcx: f32 = @floatCast(argF64(info, 2, 0));
    const vpcy: f32 = @floatCast(argF64(info, 3, 0));
    const cid: u8 = @intCast(@min(argU32(info, 4, 0), 255));
    const out = canvas_mod.screenToGraphFor(cid, sx, sy, vpcx, vpcy);
    const obj = iso.initObject();
    setObjectFloat(ctx, obj, "gx", @floatCast(out[0]));
    setObjectFloat(ctx, obj, "gy", @floatCast(out[1]));
    info.getReturnValue().set(obj.toValue());
}

fn telNetCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = telemetry.current;
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "active_connections", s.net_active_connections);
    setObjectNumber(ctx, obj, "open_connections", s.net_open_connections);
    setObjectNumber(ctx, obj, "reconnecting", s.net_reconnecting);
    setObjectNumber(ctx, obj, "event_queue_depth", s.net_event_queue_depth);
    info.getReturnValue().set(obj.toValue());
}

fn telLayoutCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = telemetry.current;
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "budget", s.layout_budget);
    setObjectNumber(ctx, obj, "budget_used", s.layout_budget_used);
    setObjectNumber(ctx, obj, "route_history_depth", s.route_history_depth);
    setObjectNumber(ctx, obj, "route_current_index", s.route_current_index);
    setObjectNumber(ctx, obj, "log_channels_enabled", s.log_channels_enabled);
    info.getReturnValue().set(obj.toValue());
}

fn telHistoryCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    var count: i32 = 40;
    if (info.length() >= 1) count = argI32(info, 0, 40);
    const n: usize = @intCast(@max(1, @min(count, 120)));
    const avail = telemetry.historyCount();
    const actual = @min(n, avail);
    const arr = iso.initArray(@intCast(actual));
    for (0..actual) |i| {
        if (telemetry.getHistory(i)) |snap| {
            _ = arr.castTo(v8.Object).setValueAtIndex(ctx, @intCast(i), iso.initNumber(@floatFromInt(snap.frame_total_us)).toValue());
        }
    }
    info.getReturnValue().set(arr.castTo(v8.Object).toValue());
}

fn telNodeCountCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setNumberReturn(info, @floatFromInt(telemetry.nodeCount()));
}

fn telNodeCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    if (info.length() < 1) {
        retUndefined(info_c);
        return;
    }
    const idx = argI32(info, 0, -1);
    if (idx < 0) {
        retUndefined(info_c);
        return;
    }
    const node = telemetry.getNode(@intCast(idx)) orelse {
        retUndefined(info_c);
        return;
    };
    const obj = iso.initObject();
    const depth = telemetry.getNodeDepth(@intCast(idx));
    setObjectNumber(ctx, obj, "depth", depth);
    setObjectNumber(ctx, obj, "child_count", node.children.len);
    setObjectFloat(ctx, obj, "x", node.computed.x);
    setObjectFloat(ctx, obj, "y", node.computed.y);
    setObjectFloat(ctx, obj, "w", node.computed.w);
    setObjectFloat(ctx, obj, "h", node.computed.h);
    setObjectBool(ctx, obj, "has_text", node.text != null);
    setObjectBool(ctx, obj, "has_image", node.image_src != null);
    setObjectBool(ctx, obj, "has_handler", node.handlers.on_press != null);
    setObjectBool(ctx, obj, "has_tooltip", node.tooltip != null);
    setObjectNumber(ctx, obj, "font_size", node.font_size);
    setObjectFloat(ctx, obj, "opacity", node.style.opacity);
    setObjectFloat(ctx, obj, "scroll_y", node.scroll_y);
    setObjectFloat(ctx, obj, "content_height", node.content_height);
    const tag = node.debug_name orelse telemetry.nodeTypeName(node);
    setObjectString(ctx, obj, "tag", tag);
    setObjectNumber(ctx, obj, "display", @intFromEnum(node.style.display));
    setObjectNumber(ctx, obj, "flex_direction", @intFromEnum(node.style.flex_direction));
    info.getReturnValue().set(obj.toValue());
}

fn telNodeStyleCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    if (info.length() < 1) {
        retUndefined(info_c);
        return;
    }
    const idx = argI32(info, 0, -1);
    if (idx < 0) {
        retUndefined(info_c);
        return;
    }
    const node = telemetry.getNode(@intCast(idx)) orelse {
        retUndefined(info_c);
        return;
    };
    const sty = node.style;
    const obj = iso.initObject();

    if (sty.width) |v| setObjectFloat(ctx, obj, "width", v) else setObjectNumber(ctx, obj, "width", -1);
    if (sty.height) |v| setObjectFloat(ctx, obj, "height", v) else setObjectNumber(ctx, obj, "height", -1);
    if (sty.min_width) |v| setObjectFloat(ctx, obj, "min_width", v);
    if (sty.max_width) |v| setObjectFloat(ctx, obj, "max_width", v);
    if (sty.min_height) |v| setObjectFloat(ctx, obj, "min_height", v);
    if (sty.max_height) |v| setObjectFloat(ctx, obj, "max_height", v);

    setObjectFloat(ctx, obj, "flex_grow", sty.flex_grow);
    if (sty.flex_shrink) |v| setObjectFloat(ctx, obj, "flex_shrink", v);
    if (sty.flex_basis) |v| setObjectFloat(ctx, obj, "flex_basis", v);
    setObjectNumber(ctx, obj, "flex_direction", @intFromEnum(sty.flex_direction));
    setObjectNumber(ctx, obj, "justify_content", @intFromEnum(sty.justify_content));
    setObjectNumber(ctx, obj, "align_items", @intFromEnum(sty.align_items));
    setObjectNumber(ctx, obj, "align_self", @intFromEnum(sty.align_self));
    setObjectFloat(ctx, obj, "gap", sty.gap);

    setObjectFloat(ctx, obj, "padding", sty.padding);
    if (sty.padding_left) |v| setObjectFloat(ctx, obj, "padding_left", v);
    if (sty.padding_right) |v| setObjectFloat(ctx, obj, "padding_right", v);
    if (sty.padding_top) |v| setObjectFloat(ctx, obj, "padding_top", v);
    if (sty.padding_bottom) |v| setObjectFloat(ctx, obj, "padding_bottom", v);

    setObjectFloat(ctx, obj, "margin", sty.margin);
    if (sty.margin_left) |v| setObjectFloat(ctx, obj, "margin_left", v);
    if (sty.margin_right) |v| setObjectFloat(ctx, obj, "margin_right", v);
    if (sty.margin_top) |v| setObjectFloat(ctx, obj, "margin_top", v);
    if (sty.margin_bottom) |v| setObjectFloat(ctx, obj, "margin_bottom", v);

    setObjectFloat(ctx, obj, "border_radius", sty.border_radius);
    setObjectFloat(ctx, obj, "border_width", sty.border_width);
    if (sty.border_top_width) |v| setObjectFloat(ctx, obj, "border_top_width", v);
    if (sty.border_right_width) |v| setObjectFloat(ctx, obj, "border_right_width", v);
    if (sty.border_bottom_width) |v| setObjectFloat(ctx, obj, "border_bottom_width", v);
    if (sty.border_left_width) |v| setObjectFloat(ctx, obj, "border_left_width", v);
    setObjectFloat(ctx, obj, "opacity", sty.opacity);
    setObjectNumber(ctx, obj, "z_index", sty.z_index);
    setObjectFloat(ctx, obj, "rotation", sty.rotation);
    setObjectFloat(ctx, obj, "scale_x", sty.scale_x);
    setObjectFloat(ctx, obj, "scale_y", sty.scale_y);

    if (sty.background_color) |bg| {
        setObjectNumber(ctx, obj, "bg_r", bg.r);
        setObjectNumber(ctx, obj, "bg_g", bg.g);
        setObjectNumber(ctx, obj, "bg_b", bg.b);
        setObjectNumber(ctx, obj, "bg_a", bg.a);
    }
    if (sty.border_color) |bc| {
        setObjectNumber(ctx, obj, "border_r", bc.r);
        setObjectNumber(ctx, obj, "border_g", bc.g);
        setObjectNumber(ctx, obj, "border_b", bc.b);
        setObjectNumber(ctx, obj, "border_a", bc.a);
    }

    setObjectNumber(ctx, obj, "position", @intFromEnum(sty.position));
    if (sty.top) |v| setObjectFloat(ctx, obj, "top", v);
    if (sty.left) |v| setObjectFloat(ctx, obj, "left", v);
    if (sty.right) |v| setObjectFloat(ctx, obj, "right", v);
    if (sty.bottom) |v| setObjectFloat(ctx, obj, "bottom", v);

    setObjectNumber(ctx, obj, "overflow", @intFromEnum(sty.overflow));
    setObjectNumber(ctx, obj, "display", @intFromEnum(sty.display));
    setObjectNumber(ctx, obj, "text_align", @intFromEnum(sty.text_align));

    info.getReturnValue().set(obj.toValue());
}

fn telNodeBoxModelCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    if (info.length() < 1) {
        retUndefined(info_c);
        return;
    }
    const idx = argI32(info, 0, -1);
    if (idx < 0) {
        retUndefined(info_c);
        return;
    }
    const node = telemetry.getNode(@intCast(idx)) orelse {
        retUndefined(info_c);
        return;
    };
    const sty = node.style;
    const r = node.computed;
    const obj = iso.initObject();
    setObjectFloat(ctx, obj, "x", r.x);
    setObjectFloat(ctx, obj, "y", r.y);
    setObjectFloat(ctx, obj, "w", r.w);
    setObjectFloat(ctx, obj, "h", r.h);
    setObjectFloat(ctx, obj, "pad_top", sty.padTop());
    setObjectFloat(ctx, obj, "pad_right", sty.padRight());
    setObjectFloat(ctx, obj, "pad_bottom", sty.padBottom());
    setObjectFloat(ctx, obj, "pad_left", sty.padLeft());
    setObjectFloat(ctx, obj, "margin_top", sty.margin_top orelse sty.margin);
    setObjectFloat(ctx, obj, "margin_right", sty.margin_right orelse sty.margin);
    setObjectFloat(ctx, obj, "margin_bottom", sty.margin_bottom orelse sty.margin);
    setObjectFloat(ctx, obj, "margin_left", sty.margin_left orelse sty.margin);
    setObjectFloat(ctx, obj, "border_width", sty.border_width);
    setObjectFloat(ctx, obj, "border_top_width", sty.brdTop());
    setObjectFloat(ctx, obj, "border_right_width", sty.brdRight());
    setObjectFloat(ctx, obj, "border_bottom_width", sty.brdBottom());
    setObjectFloat(ctx, obj, "border_left_width", sty.brdLeft());
    const pl = sty.padLeft();
    const pr = sty.padRight();
    const pt = sty.padTop();
    const pb = sty.padBottom();
    setObjectFloat(ctx, obj, "content_w", @max(0, r.w - pl - pr));
    setObjectFloat(ctx, obj, "content_h", @max(0, r.h - pt - pb));
    info.getReturnValue().set(obj.toValue());
}

fn ptyOpenCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    var cols: u16 = 80;
    var rows: u16 = 24;
    const alloc = std.heap.page_allocator;
    var shell: ?[:0]u8 = null;
    var cwd: ?[:0]u8 = null;
    if (info.length() >= 1) {
        const v = argI32(info, 0, 80);
        if (v > 0) cols = @intCast(v);
    }
    if (info.length() >= 2) {
        const v = argI32(info, 1, 24);
        if (v > 0) rows = @intCast(v);
    }
    if (info.length() >= 3) {
        shell = argOwnedUtf8Z(alloc, info, 2);
    }
    if (info.length() >= 4) {
        cwd = argOwnedUtf8Z(alloc, info, 3);
    }
    defer if (shell) |value| alloc.free(value);
    defer if (cwd) |value| alloc.free(value);
    const slot = blk: {
        var idx: usize = 0;
        while (idx < MAX_PTYS) : (idx += 1) {
            if (g_ptys[idx] == null) break :blk idx;
        }
        setNumberReturn(info, -1);
        return;
    };
    _ = ctx;
    const host = v8rt.hostContext(iso);
    g_ptys[slot] = pty_mod.openPty(host.gpa, host.io, .{
        .cols = cols,
        .rows = rows,
        .shell = if (shell) |value| value.ptr else "bash",
        .cwd = if (cwd) |value| value.ptr else null,
    }) catch {
        setNumberReturn(info, -1);
        return;
    };
    if (g_active_pty_handle == 0) g_active_pty_handle = @intCast(slot + 1);
    setNumberReturn(info, @as(f64, @floatFromInt(slot + 1)));
}

fn ptyReadCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const handle = argI32(info, 0, 0);
    if (handle > 0 and @as(usize, @intCast(handle - 1)) < MAX_PTYS) {
        if (g_ptys[@intCast(handle - 1)]) |*p| {
            if (p.readData()) |data| {
                info.getReturnValue().set(iso.initStringUtf8(data).toValue());
                return;
            }
        }
    }
    retUndefined(info_c);
}

fn ptyWriteCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const handle = argI32(info, 0, 0);
    const str = argOwnedUtf8(alloc, info, 1) orelse return;
    defer alloc.free(str);
    if (handle > 0 and @as(usize, @intCast(handle - 1)) < MAX_PTYS) {
        if (g_ptys[@intCast(handle - 1)]) |*p| _ = p.writeData(str);
    }
    retUndefined(info_c);
}

fn ptyAliveCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const handle = argI32(info, 0, 0);
    if (handle > 0 and @as(usize, @intCast(handle - 1)) < MAX_PTYS) {
        if (g_ptys[@intCast(handle - 1)]) |*p| {
            const ok = p.alive();
            if (!ok) {
                p.closePty();
                g_ptys[@intCast(handle - 1)] = null;
                if (g_active_pty_handle == handle) g_active_pty_handle = 0;
            }
            setNumberReturn(info, if (ok) 1 else 0);
            return;
        }
    }
    setNumberReturn(info, 0);
}

fn ptyCloseCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const handle = argI32(info, 0, 0);
    if (handle > 0 and @as(usize, @intCast(handle - 1)) < MAX_PTYS) {
        if (g_ptys[@intCast(handle - 1)]) |*p| p.closePty();
        g_ptys[@intCast(handle - 1)] = null;
        if (g_active_pty_handle == handle) g_active_pty_handle = 0;
    }
    retUndefined(info_c);
}

fn ptyFocusCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const handle = argI32(info, 0, 0);
    if (handle > 0 and @as(usize, @intCast(handle - 1)) < MAX_PTYS and g_ptys[@intCast(handle - 1)] != null) {
        g_active_pty_handle = @intCast(handle);
    } else {
        g_active_pty_handle = 0;
    }
    retUndefined(info_c);
}

fn ptyCwdCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    const handle = argI32(info, 0, 0);
    if (handle > 0 and @as(usize, @intCast(handle - 1)) < MAX_PTYS) {
        if (g_ptys[@intCast(handle - 1)]) |*p| {
            const pid = p.processId() orelse {
                setStringReturn(info, "");
                return;
            };
            var path_buf: [64]u8 = undefined;
            const path = std.fmt.bufPrint(&path_buf, "/proc/{d}/cwd", .{pid}) catch {
                setStringReturn(info, "");
                return;
            };
            var cwd_buf: [4096]u8 = undefined;
            const cwd_len = std.Io.Dir.readLinkAbsolute(io, path, &cwd_buf) catch {
                setStringReturn(info, "");
                return;
            };
            setStringReturn(info, cwd_buf[0..cwd_len]);
            return;
        }
    }
    setStringReturn(info, "");
}

fn readProcField(io: std.Io, pid: u32, field: []const u8, buf: []u8) ![]const u8 {
    var path_buf: [256]u8 = undefined;
    const path = try std.fmt.bufPrintZ(&path_buf, "/proc/{d}/{s}", .{ pid, field });
    var file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return error.NotFound;
    defer file.close(io);
    const n = file.readPositionalAll(io, buf, 0) catch return error.NotFound;
    var slice = buf[0..n];
    while (slice.len > 0 and (slice[slice.len - 1] == '\n' or slice[slice.len - 1] == 0)) {
        slice = slice[0 .. slice.len - 1];
    }
    return slice;
}

fn getProcessesJsonCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const io = v8rt.hostContext(iso).io;
    const c2 = iso.getCurrentContext();
    const alloc = std.heap.page_allocator;
    var list: std.ArrayList(u8) = .empty;
    defer list.deinit(alloc);
    list.append(alloc, '[') catch {
        setStringReturn(info, "[]");
        return;
    };

    var proc_dir = std.Io.Dir.openDirAbsolute(io, "/proc", .{ .iterate = true }) catch {
        setStringReturn(info, "[]");
        return;
    };
    defer proc_dir.close(io);

    var it = proc_dir.iterate();
    var first = true;
    while (it.next(io) catch null) |entry| {
        if (entry.kind != .directory) continue;
        const pid = std.fmt.parseInt(u32, entry.name, 10) catch continue;

        var name_buf: [256]u8 = undefined;
        const name = readProcField(io, pid, "comm", &name_buf) catch continue;

        var task_path_buf: [256]u8 = undefined;
        const task_path = std.fmt.bufPrintZ(&task_path_buf, "/proc/{d}/task", .{pid}) catch continue;
        var task_dir = std.Io.Dir.openDirAbsolute(io, task_path, .{ .iterate = true }) catch continue;
        defer task_dir.close(io);
        var nthreads: u32 = 0;
        var tit = task_dir.iterate();
        while (tit.next(io) catch null) |tentry| {
            if (tentry.kind == .directory) nthreads += 1;
        }

        if (!first) list.append(alloc, ',') catch break;
        first = false;
        var prefix_buf: [64]u8 = undefined;
        const prefix = std.fmt.bufPrint(&prefix_buf, "{{\"pid\":{d},\"nthreads\":{d},\"name\":", .{ pid, nthreads }) catch break;
        list.appendSlice(alloc, prefix) catch break;
        appendJsonEscaped(&list, alloc, name) catch break;
        list.append(alloc, '}') catch break;
    }
    list.append(alloc, ']') catch {};
    _ = c2;
    setStringReturn(info, list.items);
}

const ThreadStat = struct { core: i32 = -1, cputime: u64 = 0 };

fn readThreadStat(io: std.Io, pid: u32, tid: u32) ThreadStat {
    var stat_path_buf: [256]u8 = undefined;
    const stat_path = std.fmt.bufPrintZ(&stat_path_buf, "/proc/{d}/task/{d}/stat", .{ pid, tid }) catch return .{};
    var file = std.Io.Dir.openFileAbsolute(io, stat_path, .{}) catch return .{};
    defer file.close(io);
    var buf: [1024]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return .{};
    const data = buf[0..n];
    const rparen = std.mem.lastIndexOfScalar(u8, data, ')') orelse return .{};
    var rest = data[rparen + 1 ..];
    var field: usize = 3;
    var idx: usize = 0;
    var utime: u64 = 0;
    var stime: u64 = 0;
    var core: i32 = -1;
    while (idx < rest.len) {
        while (idx < rest.len and rest[idx] == ' ') idx += 1;
        const start = idx;
        while (idx < rest.len and rest[idx] != ' ' and rest[idx] != '\n') idx += 1;
        const tok = rest[start..idx];
        if (tok.len == 0) break;
        if (field == 14) utime = std.fmt.parseInt(u64, tok, 10) catch 0;
        if (field == 15) stime = std.fmt.parseInt(u64, tok, 10) catch 0;
        if (field == 39) core = std.fmt.parseInt(i32, tok, 10) catch -1;
        field += 1;
        if (field > 40) break;
    }
    return .{ .core = core, .cputime = utime + stime };
}

fn getThreadsJsonCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const io = v8rt.hostContext(iso).io;
    const c2 = iso.getCurrentContext();
    const alloc = std.heap.page_allocator;
    if (info.length() < 1) {
        setStringReturn(info, "[]");
        return;
    }
    const pid_f = argF64(info, 0, 0);
    const pid: u32 = @trunc(pid_f);
    var list: std.ArrayList(u8) = .empty;
    defer list.deinit(alloc);
    list.append(alloc, '[') catch {
        setStringReturn(info, "[]");
        return;
    };

    var task_path_buf: [256]u8 = undefined;
    const task_path = std.fmt.bufPrintZ(&task_path_buf, "/proc/{d}/task", .{pid}) catch {
        setStringReturn(info, "[]");
        return;
    };
    var task_dir = std.Io.Dir.openDirAbsolute(io, task_path, .{ .iterate = true }) catch {
        setStringReturn(info, "[]");
        return;
    };
    defer task_dir.close(io);

    var it = task_dir.iterate();
    var first = true;
    while (it.next(io) catch null) |entry| {
        if (entry.kind != .directory) continue;
        const tid = std.fmt.parseInt(u32, entry.name, 10) catch continue;
        var comm_path_buf: [256]u8 = undefined;
        const comm_path = std.fmt.bufPrintZ(&comm_path_buf, "/proc/{d}/task/{d}/comm", .{ pid, tid }) catch continue;
        var file = std.Io.Dir.openFileAbsolute(io, comm_path, .{}) catch continue;
        defer file.close(io);
        var name_buf: [256]u8 = undefined;
        const n = file.readPositionalAll(io, &name_buf, 0) catch continue;
        var name = name_buf[0..n];
        while (name.len > 0 and (name[name.len - 1] == '\n' or name[name.len - 1] == 0)) {
            name = name[0 .. name.len - 1];
        }
        const tstat = readThreadStat(io, pid, tid);
        if (!first) list.append(alloc, ',') catch break;
        first = false;
        var prefix_buf: [96]u8 = undefined;
        const prefix = std.fmt.bufPrint(&prefix_buf, "{{\"tid\":{d},\"core\":{d},\"cpu\":{d},\"name\":", .{ tid, tstat.core, tstat.cputime }) catch break;
        list.appendSlice(alloc, prefix) catch break;
        appendJsonEscaped(&list, alloc, name) catch break;
        list.append(alloc, '}') catch break;
    }
    list.append(alloc, ']') catch {};
    _ = c2;
    setStringReturn(info, list.items);
}

fn getCoreCountCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    var count: u32 = 0;
    var cpu_dir = std.Io.Dir.openDirAbsolute(io, "/sys/devices/system/cpu", .{ .iterate = true }) catch {
        setNumberReturn(info, 1);
        return;
    };
    defer cpu_dir.close(io);
    var it = cpu_dir.iterate();
    while (it.next(io) catch null) |entry| {
        if (entry.kind != .directory) continue;
        if (entry.name.len < 4) continue;
        if (!std.mem.startsWith(u8, entry.name, "cpu")) continue;
        _ = std.fmt.parseInt(u32, entry.name[3..], 10) catch continue;
        count += 1;
    }
    if (count == 0) count = 1;
    setNumberReturn(info, count);
}

fn hotGetCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const key = argOwnedUtf8(alloc, info, 0) orelse {
        setNullReturn(info);
        return;
    };
    defer alloc.free(key);
    const val = hotstate.get(key);
    if (val) |v| {
        setStringReturn(info, v);
    } else {
        setNullReturn(info);
    }
}

fn hotSetCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const key = argOwnedUtf8(alloc, info, 0) orelse {
        retUndefined(info_c);
        return;
    };
    defer alloc.free(key);
    const val = argOwnedUtf8(alloc, info, 1) orelse {
        retUndefined(info_c);
        return;
    };
    defer alloc.free(val);
    hotstate.set(key, val);
    retUndefined(info_c);
}

fn hotRemoveCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const key = argOwnedUtf8(alloc, info, 0) orelse {
        retUndefined(info_c);
        return;
    };
    defer alloc.free(key);
    hotstate.remove(key);
    retUndefined(info_c);
}

fn hotClearCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hotstate.clear();
    retUndefined(info_c);
}

fn hotKeysJsonCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const json = hotstate.keysJson(alloc) catch {
        setStringReturn(info, "[]");
        return;
    };
    defer alloc.free(json);
    setStringReturn(info, json);
}

fn dbQueryCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const iso = info.getIsolate();
    const io = v8rt.hostContext(iso).io;
    const ctx = iso.getCurrentContext();
    if (info.length() < 2) {
        setStringReturn(info, "");
        return;
    }
    const path = argOwnedUtf8(alloc, info, 0) orelse {
        setStringReturn(info, "");
        return;
    };
    defer alloc.free(path);
    const sql = argOwnedUtf8(alloc, info, 1) orelse {
        setStringReturn(info, "");
        return;
    };
    defer alloc.free(sql);

    var db = sqlite_mod.Database.open(io, path) catch {
        setStringReturn(info, "");
        return;
    };
    defer db.close();

    const sql_z = alloc.allocSentinel(u8, sql.len, 0) catch {
        setStringReturn(info, "");
        return;
    };
    defer alloc.free(sql_z);
    @memcpy(sql_z[0..sql.len], sql);

    var stmt = db.prepare(sql_z.ptr) catch {
        setStringReturn(info, "");
        return;
    };
    defer stmt.deinit();

    var out: [65536]u8 = undefined;
    var pos: usize = 0;
    while (true) {
        const has_row = stmt.step() catch break;
        if (!has_row) break;
        const ncols = stmt.columnCount();
        var col: c_int = 0;
        while (col < ncols) : (col += 1) {
            if (col > 0 and pos < out.len) {
                out[pos] = '|';
                pos += 1;
            }
            const val = stmt.columnText(col) orelse "";
            const copy_len = @min(val.len, out.len - pos);
            if (copy_len > 0) {
                @memcpy(out[pos .. pos + copy_len], val[0..copy_len]);
                pos += copy_len;
            }
        }
        if (pos < out.len) {
            out[pos] = '\n';
            pos += 1;
        }
    }
    if (pos == 0) {
        setStringReturn(info, "");
        return;
    }
    _ = ctx;
    setStringReturn(info, out[0..pos]);
}

fn getProcessesJsonForRegistration() v8.c.FunctionCallback {
    return getProcessesJsonCb;
}

pub fn registerTelemetry(_: anytype) void {
    v8rt.registerHostFn("getFps", getFpsCb);
    v8rt.registerHostFn("getLayoutUs", getLayoutUsCb);
    v8rt.registerHostFn("getPaintUs", getPaintUsCb);

    v8rt.registerHostFn("__tel_frame", telFrameCb);
    v8rt.registerHostFn("__tel_frame_at", telFrameAtCb);
    v8rt.registerHostFn("__tel_host_flush", telHostFlushCb);
    v8rt.registerHostFn("__tel_gpu", telGpuCb);
    v8rt.registerHostFn("__tel_nodes", telNodesCb);
    v8rt.registerHostFn("__tel_history", telHistoryCb);
    v8rt.registerHostFn("__tel_input", telInputCb);
    v8rt.registerHostFn("__tel_layout", telLayoutCb);
    v8rt.registerHostFn("__tel_net", telNetCb);
    v8rt.registerHostFn("__tel_node", telNodeCb);
    v8rt.registerHostFn("__tel_node_box_model", telNodeBoxModelCb);
    v8rt.registerHostFn("__tel_node_style", telNodeStyleCb);
    v8rt.registerHostFn("__tel_node_count", telNodeCountCb);
    v8rt.registerHostFn("__tel_system", telSystemCb);
    v8rt.registerHostFn("__tel_canvas", telCanvasCb);
    v8rt.registerHostFn("__canvas_screen_to_graph", canvasScreenToGraphCb);

    v8rt.registerHostFn("getProcessesJson", getProcessesJsonCb);
    v8rt.registerHostFn("getThreadsJson", getThreadsJsonCb);
    v8rt.registerHostFn("getCoreCount", getCoreCountCb);

    v8rt.registerHostFn("__pty_open", ptyOpenCb);
    v8rt.registerHostFn("__pty_read", ptyReadCb);
    v8rt.registerHostFn("__pty_write", ptyWriteCb);
    v8rt.registerHostFn("__pty_alive", ptyAliveCb);
    v8rt.registerHostFn("__pty_close", ptyCloseCb);
    v8rt.registerHostFn("__pty_focus", ptyFocusCb);
    v8rt.registerHostFn("__pty_cwd", ptyCwdCb);

    v8rt.registerHostFn("__store_set", storeSetCb);
    v8rt.registerHostFn("__store_get", storeGetCb);
    v8rt.registerHostFn("__store_remove", storeRemoveCb);
    v8rt.registerHostFn("__store_clear", storeClearCb);
    v8rt.registerHostFn("__store_keys_json", storeKeysJsonCb);

    v8rt.registerHostFn("__hot_set", hotSetCb);
    v8rt.registerHostFn("__hot_get", hotGetCb);
    v8rt.registerHostFn("__hot_remove", hotRemoveCb);
    v8rt.registerHostFn("__hot_clear", hotClearCb);
    v8rt.registerHostFn("__hot_keys_json", hotKeysJsonCb);

    v8rt.registerHostFn("__db_query", dbQueryCb);
}

fn storeGetCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    if (!localstore.isInitialized()) {
        setNullReturn(info);
        return;
    }
    const key = argOwnedUtf8(alloc, info, 0) orelse {
        setNullReturn(info);
        return;
    };
    defer alloc.free(key);
    // alloc-based read: MAX_VALUE is 4MB now (heap-backed values), far too
    // big for a stack buffer
    const value = localstore.getAlloc(io, alloc, LS_NS, key) catch {
        setNullReturn(info);
        return;
    };
    if (value) |v| {
        defer alloc.free(v);
        setStringReturn(info, v);
    } else {
        setNullReturn(info);
    }
}

fn storeSetCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    if (!localstore.isInitialized()) {
        retUndefined(info_c);
        return;
    }
    const key = argOwnedUtf8(alloc, info, 0) orelse {
        retUndefined(info_c);
        return;
    };
    defer alloc.free(key);
    const val = argOwnedUtf8(alloc, info, 1) orelse {
        retUndefined(info_c);
        return;
    };
    defer alloc.free(val);
    localstore.set(io, LS_NS, key, val) catch |err| {
        // a swallowed set is invisible data loss — fail loud on stderr
        std.debug.print("[localstore] SET FAILED ns={s} key={s} len={d}: {s}\n", .{ LS_NS, key, val.len, @errorName(err) });
    };
    retUndefined(info_c);
}

fn storeRemoveCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    if (!localstore.isInitialized()) {
        retUndefined(info_c);
        return;
    }
    const key = argOwnedUtf8(alloc, info, 0) orelse {
        retUndefined(info_c);
        return;
    };
    defer alloc.free(key);
    localstore.delete(io, LS_NS, key) catch {};
    retUndefined(info_c);
}

fn storeClearCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    if (!localstore.isInitialized()) {
        retUndefined(info_c);
        return;
    }
    localstore.clear(io, LS_NS) catch {};
    retUndefined(info_c);
}

fn storeKeysJsonCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    if (!localstore.isInitialized()) {
        setStringReturn(info, "[]");
        return;
    }
    var entries: [localstore.MAX_KEYS]localstore.KeyEntry = undefined;
    const n = localstore.keys(io, LS_NS, &entries) catch {
        setStringReturn(info, "[]");
        return;
    };
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    out.append(alloc, '[') catch {
        setStringReturn(info, "[]");
        return;
    };
    var i: usize = 0;
    while (i < n) : (i += 1) {
        if (i > 0) out.append(alloc, ',') catch break;
        appendJsonEscaped(&out, alloc, entries[i].key()) catch break;
    }
    out.append(alloc, ']') catch {
        setStringReturn(info, "[]");
        return;
    };
    setStringReturn(info, out.items);
}
