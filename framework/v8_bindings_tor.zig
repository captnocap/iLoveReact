//! Tor host bindings — V8 FFI bridge for net/tor.zig.
//!
//! JS surface (mirrors runtime/hooks/useConnection.ts kind:'tor'):
//!   __tor_start(id, optsJson)   // optsJson: { identity?, hiddenServicePort? }
//!   __tor_stop(id)
//!
//! Events fire via __ffiEmit when bootstrap completes:
//!   __ffiEmit('tor:open:<id>', '{"socksPort":N,"hostname":"abc.onion","hsPort":M}')
//!   __ffiEmit('tor:error:<id>', message)
//!
//! Tor itself is a single-instance global (net/tor.zig), so multiple
//! useConnection({kind:'tor'}) handles share one process. The first start
//! wins; subsequent starts no-op and the existing handle's event fires.

const std = @import("std");
const HostContext = @import("host_context.zig");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const tor = @import("net/tor.zig");

const alloc = std.heap.c_allocator;

// ── Registry — handles waiting for bootstrap ───────────────────────

const TorEntry = struct { id: u32, opened: bool };
var g_tor: std.ArrayList(TorEntry) = .empty;

fn findTor(id: u32) ?*TorEntry {
    for (g_tor.items) |*e| if (e.id == id) return e;
    return null;
}

fn removeTor(id: u32) void {
    var i: usize = g_tor.items.len;
    while (i > 0) {
        i -= 1;
        if (g_tor.items[i].id == id) {
            _ = g_tor.orderedRemove(i);
            return;
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────

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

fn argToU32(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    const v = info.getArg(idx).toI32(ctx) catch return null;
    return if (v >= 0) @intCast(v) else null;
}

fn emitEvent(host: *HostContext, channel: []const u8, payload: []const u8) void {
    var chan_buf: std.ArrayList(u8) = .empty;
    defer chan_buf.deinit(alloc);
    chan_buf.appendSlice(alloc, channel) catch return;
    chan_buf.append(alloc, 0) catch return;
    const chan_z = chan_buf.items[0 .. chan_buf.items.len - 1 :0];

    var payload_buf: std.ArrayList(u8) = .empty;
    defer payload_buf.deinit(alloc);
    payload_buf.appendSlice(alloc, payload) catch return;
    payload_buf.append(alloc, 0) catch return;
    const payload_z = payload_buf.items[0 .. payload_buf.items.len - 1 :0];

    v8_runtime.callGlobal2Str(host, "__ffiEmit", chan_z, payload_z);
}

// Minimal extraction of a string field "key":"value" from a JSON blob.
// Good enough for the small option object useConnection sends; avoids
// pulling in a full JSON parser at the binding boundary.
fn jsonGetString(json: []const u8, key: []const u8, out: []u8) ?usize {
    var pat_buf: [64]u8 = undefined;
    const pat = std.fmt.bufPrint(&pat_buf, "\"{s}\"", .{key}) catch return null;
    const k = std.mem.indexOf(u8, json, pat) orelse return null;
    var i = k + pat.len;
    while (i < json.len and json[i] != ':') i += 1;
    if (i >= json.len) return null;
    i += 1;
    while (i < json.len and (json[i] == ' ' or json[i] == '\t')) i += 1;
    if (i >= json.len or json[i] != '"') return null;
    i += 1;
    var n: usize = 0;
    while (i < json.len and json[i] != '"' and n < out.len) : (i += 1) {
        out[n] = json[i];
        n += 1;
    }
    return n;
}

fn jsonGetU16(json: []const u8, key: []const u8) ?u16 {
    var pat_buf: [64]u8 = undefined;
    const pat = std.fmt.bufPrint(&pat_buf, "\"{s}\"", .{key}) catch return null;
    const k = std.mem.indexOf(u8, json, pat) orelse return null;
    var i = k + pat.len;
    while (i < json.len and json[i] != ':') i += 1;
    if (i >= json.len) return null;
    i += 1;
    while (i < json.len and (json[i] == ' ' or json[i] == '\t')) i += 1;
    var n: u32 = 0;
    var any = false;
    while (i < json.len and json[i] >= '0' and json[i] <= '9') : (i += 1) {
        n = n * 10 + (json[i] - '0');
        any = true;
    }
    if (!any) return null;
    return @intCast(@min(n, 65535));
}

// ── Host fns ───────────────────────────────────────────────────────

fn hostTorStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const host = v8_runtime.hostContext(info.getIsolate());
    const id = argToU32(info, 0) orelse return;
    const opts_json = argToStringAlloc(info, 1) orelse alloc.dupe(u8, "{}") catch return;
    defer alloc.free(opts_json);

    if (findTor(id) != null) return; // already starting/started for this handle

    var ident_buf: [64]u8 = undefined;
    const ident_len = jsonGetString(opts_json, "identity", &ident_buf) orelse 0;
    const identity: []const u8 = if (ident_len > 0) ident_buf[0..ident_len] else "default";
    const hs_port = jsonGetU16(opts_json, "hiddenServicePort") orelse 80;
    const sp = jsonGetU16(opts_json, "socksPort") orelse 0;

    tor.start(host.io, host.environ, .{
        .identity = identity,
        .hidden_service_port = hs_port,
        .socks_port = sp,
    }) catch |e| {
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "tor:error:{d}", .{id}) catch return;
        var msg_buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "start: {s}", .{@errorName(e)}) catch "start failed";
        emitEvent(host, chan, msg);
        return;
    };
    g_tor.append(alloc, .{ .id = id, .opened = false }) catch return;
}

fn hostTorStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const id = argToU32(info, 0) orelse return;
    removeTor(id);
    // Only stop the global Tor process when the last handle goes away.
    if (g_tor.items.len == 0 and tor.isRunning()) tor.stop(io);
}

// ── Tick drain — emit tor:open once hostname is published ──────────

pub fn tickDrain(host: *HostContext) void {
    if (g_tor.items.len == 0) return;
    const hostname = tor.getHostname(host.io) orelse return;
    const socks_port = tor.getProxyPort();
    const hs_port = tor.getHsPort();

    for (g_tor.items) |*e| {
        if (e.opened) continue;
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "tor:open:{d}", .{e.id}) catch continue;
        var payload_buf: [256]u8 = undefined;
        const payload = std.fmt.bufPrint(&payload_buf, "{{\"socksPort\":{d},\"hostname\":\"{s}\",\"hsPort\":{d}}}", .{ socks_port, hostname, hs_port }) catch continue;
        emitEvent(host, chan, payload);
        e.opened = true;
    }
}

// ── Registration ───────────────────────────────────────────────────

pub fn registerTor(_: anytype) void {
    v8_runtime.registerHostFn("__tor_start", hostTorStart);
    v8_runtime.registerHostFn("__tor_stop", hostTorStop);
}
