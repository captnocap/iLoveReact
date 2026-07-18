// INTEGRATION: wire this workstream into the host once (these are the ONLY
// edits to shared files — left to the supervising thread, not done here):
//
//   1. build.zig — the editor-cart app module already compiles framework/ as
//      source; no module wiring is needed for diag_registry.zig +
//      v8_bindings_editor_diag.zig (they're plain @import siblings under
//      framework/diag/, like v8_bindings_eventbus.zig). Nothing to add unless
//      the host file list is explicit; if so, add this file next to the other
//      v8_bindings_*.zig entries.
//
//   2. v8_app.zig — import + register alongside the other binding registrations
//      (near v8_bindings_reconciler.register(); ~line 4067):
//          const editor_diag = @import("diag/v8_bindings_editor_diag.zig");
//          ...
//          editor_diag.register();
//      `register()` calls diag_registry.init() and installs the feed sink, so
//      no separate init call is required.
//
// Doors registered (Seam 3 — runtime/diag/channel.ts + console/feed.ts):
//   __diag_emit(channelId, severity, msg, fieldsJson) -> void   [contract]
//   __diag_set_enabled(channelId, on)                 -> void   [contract]
//   __diag_set_sample(channelId, div)                 -> void   [cost-tier ext]
//   __diag_recent(maxN)                               -> json   [console catch-up]
//   __diag_channels_state()                           -> json   [host channel state]
//
// On every accepted line the registry sink re-broadcasts the serialized line on
// the `diag.feed` ffi channel (via __ffiEmit) so the console live-tails it, and
// mirrors it to the observability event_bus as a secondary sink.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("../v8_runtime.zig");
const HostContext = @import("../host_context.zig");
const diag = @import("diag_registry.zig");
const event_bus = @import("event_bus.zig");

const alloc = std.heap.c_allocator;

// Stack scratch for one null-terminated feed line. Comfortably above the
// registry's per-line serialization cap.
const FEED_LINE_CAP: usize = 2048;
// ── arg helpers (mirrors v8_bindings_eventbus.zig) ──────────────────────────

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(info.getIsolate().getCurrentContext()) catch null;
}

fn argToU32(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const f = argToF64(info, idx) orelse return null;
    if (f < 0) return null;
    return @intFromFloat(f);
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), text));
}

// ── The sink: each accepted line goes to the console feed + event_bus ───────

fn feedSink(context: ?*anyopaque, line_json: []const u8) void {
    const host: *HostContext = @ptrCast(@alignCast(context orelse return));
    // (a) Live-tail to the in-app console. __ffiEmit wants null-terminated
    //     strings; copy into a stack buffer (lines are bounded by the
    //     registry's LINE_JSON_CAP).
    var buf: [FEED_LINE_CAP]u8 = undefined; // generous; line << this
    if (line_json.len < buf.len) {
        @memcpy(buf[0..line_json.len], line_json);
        buf[line_json.len] = 0;
        const z: [*:0]const u8 = @ptrCast(&buf);
        v8_runtime.callGlobal2Str(host, "__ffiEmit", diag.DIAG_FEED_CHANNEL, z);
    }
    // (b) Mirror to the observability bus as a secondary sink. The whole line
    //     is already JSON; tag it so eventlog can find diag traffic.
    _ = event_bus.emit("diag.line", "framework/diag", null, line_json);
}

// ── Doors ───────────────────────────────────────────────────────────────────

fn hostDiagEmit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const channel = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(channel);
    const severity = argToStringAlloc(info, 1) orelse return;
    defer alloc.free(severity);
    const msg = argToStringAlloc(info, 2) orelse return;
    defer alloc.free(msg);
    const fields = argToStringAlloc(info, 3) orelse {
        _ = diag.emitStr(host.io, channel, severity, msg, "{}");
        return;
    };
    defer alloc.free(fields);
    _ = diag.emitStr(host.io, channel, severity, msg, fields);
}

fn hostDiagSetEnabled(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const channel = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(channel);
    const on_f = argToF64(info, 1) orelse 0;
    diag.setEnabled(channel, on_f != 0);
}

fn hostDiagSetSample(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const channel = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(channel);
    const div = argToU32(info, 1) orelse 1;
    diag.setSampleDiv(channel, div);
}

fn hostDiagRecent(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const max_n: usize = argToU32(info, 0) orelse 500;
    const json = diag.recentJson(alloc, max_n) catch {
        setReturnString(info, "[]");
        return;
    };
    defer alloc.free(json);
    setReturnString(info, json);
}

fn hostDiagChannelsState(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const json = diag.channelsJson(alloc) catch {
        setReturnString(info, "[]");
        return;
    };
    defer alloc.free(json);
    setReturnString(info, json);
}

pub fn register(host: *HostContext) void {
    diag.init();
    diag.setFeedSink(.{ .context = host, .write = feedSink });
    v8_runtime.registerHostFn("__diag_emit", hostDiagEmit);
    v8_runtime.registerHostFn("__diag_set_enabled", hostDiagSetEnabled);
    v8_runtime.registerHostFn("__diag_set_sample", hostDiagSetSample);
    v8_runtime.registerHostFn("__diag_recent", hostDiagRecent);
    v8_runtime.registerHostFn("__diag_channels_state", hostDiagChannelsState);
}

/// INGREDIENTS-catalog entry point (matches the reg_fn(anytype) convention used
/// by v8_ingredients.zig). Diagnostics are always-on observability, like the
/// eventbus — so this rides the always-on (required=true) block.
pub fn registerEditorDiag(host: *HostContext) void {
    register(host);
}
