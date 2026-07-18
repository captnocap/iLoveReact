//! V8 bindings for the host↔guest vsock transport.
//!
//! This file is the **interface contract** for the production transport
//! that will replace the in-process LocalPair simulator in
//! `runtime/hooks/vsock.ts`. It is NOT yet registered in the build —
//! `framework/build.zig` deliberately omits this module so the runtime
//! falls through to LocalPair until AF_VSOCK is implemented. To
//! activate, add a call to `registerVsock(...)` in the V8 init path
//! (the same place `registerEventBus` is called) and fill in the
//! `TODO(af-vsock)` blocks below.
//!
//! Interface (matching `runtime/hooks/vsock.ts`):
//!
//!   __vsock_open(optsJson: string) → handle (number)
//!     optsJson is a JSON-serialized OpenVsockOpts:
//!       { kind: 'host' | 'guest', vmid?: string, transport?: ... }
//!     Returns a positive handle id, or 0 to signal "open failed —
//!     caller should fall back."
//!
//!   __vsock_send(handle: number, envelopeJson: string) → bool
//!     envelopeJson is `{"channel":"<bus channel>","payload":<any>}`.
//!     Returns true on success, false on transport error.
//!
//!   __vsock_close(handle: number)
//!     Idempotent. Tear down the connection and free the handle.
//!
//! Receive path: when an envelope arrives, emit it onto the JS bus
//! channel `vsock:<handle>:envelope`. The HostFnTransport in vsock.ts
//! subscribes there. Use `v8_runtime.evalExpr` (the system-signal
//! pattern from useIFTTT.md) or a typed `__ffiEmit` call.
//!
//! Two transport flavors to ship:
//!
//!   1. AF_VSOCK (production) — kind='guest' uses VMADDR_CID_HOST (2);
//!      kind='host' uses VMADDR_CID_ANY listening, and the guest's CID
//!      maps to a vmid via the host-side handle table (the spawning
//!      orchestrator records vmid → CID when the VM boots).
//!
//!   2. AF_UNIX (dev fallback) — kind='guest' connects to
//!      /run/reactjit/vsock-host.sock; kind='host' to
//!      /run/reactjit/vsock-vm-<vmid>.sock. Useful when running
//!      without Firecracker but with a real fork(); the LocalPair
//!      simulator already covers single-process testing.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");

const alloc = std.heap.c_allocator;

// Handle table — maps the integer ids we hand to JS to the underlying
// fd / state. TODO(af-vsock): replace the placeholder Handle with a
// tagged union over { afvsock: posix.fd_t, afunix: posix.fd_t } and
// add a per-handle read thread / poll registration.
const Handle = struct {
    fd: i32,
    vmid: ?[]const u8,
    kind: enum { host, guest },
};

var handles: std.AutoHashMap(u32, Handle) = undefined;
var next_id: u32 = 1;
var initialized: bool = false;

fn ensureInit() void {
    if (initialized) return;
    handles = std.AutoHashMap(u32, Handle).init(alloc);
    initialized = true;
}

// ── Argument helpers (mirroring v8_bindings_eventbus.zig) ────────

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
    const f = info.getArg(idx).toF64(info.getIsolate().getCurrentContext()) catch return null;
    if (f < 0) return null;
    return @trunc(f);
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn setReturnBool(info: v8.FunctionCallbackInfo, b: bool) void {
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), b));
}

// ── Host functions ───────────────────────────────────────────────

fn hostVsockOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureInit();
    const opts_json = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(opts_json);

    // TODO(af-vsock): parse OpenVsockOpts, decide AF_VSOCK vs AF_UNIX,
    // open the socket, register the handle, spawn a read thread that
    // calls v8_runtime.evalExpr with __ffiEmit('vsock:<id>:envelope', …).
    //
    // Returning 0 here signals "open failed" — vsock.ts falls through
    // to LocalPair, which is the current dev path.
    _ = opts_json;
    setReturnNumber(info, 0);
}

fn hostVsockSend(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureInit();
    const handle = argToU32(info, 0) orelse return setReturnBool(info, false);
    const envelope = argToStringAlloc(info, 1) orelse return setReturnBool(info, false);
    defer alloc.free(envelope);

    // TODO(af-vsock): write a length-prefixed frame to handles.get(handle).fd.
    _ = handle;
    setReturnBool(info, false);
}

fn hostVsockClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureInit();
    const handle = argToU32(info, 0) orelse return;

    // TODO(af-vsock): close the fd, deregister, stop the read thread.
    if (handles.fetchRemove(handle)) |kv| {
        _ = kv;
    }
}

// ── Registration ─────────────────────────────────────────────────
//
// Currently NOT called from the V8 init path (build.zig omits this
// module). Registering this would make `hasHost('__vsock_open')` true
// in vsock.ts, which would route `openVsock` through HostFnTransport
// — and these stubs return failure, so users would silently lose the
// LocalPair fallback. Don't register until the TODOs above are filled.

pub fn registerVsock(_: anytype) void {
    v8_runtime.registerHostFn("__vsock_open", hostVsockOpen);
    v8_runtime.registerHostFn("__vsock_send", hostVsockSend);
    v8_runtime.registerHostFn("__vsock_close", hostVsockClose);
}
