// clipboard_watch.zig — system clipboard polling watcher.
//
// Producer side of the system-signals chain. Polls SDL_GetClipboardText every
// POLL_MS, hashes it, and when the hash changes calls
// __ifttt_onClipboardChange() in JS. The JS handler then re-reads the live
// value via __clipboard_get and busEmit's 'system:clipboard' to subscribers.
//
// Why not push the text as an arg? Constructing a JS-escaped string literal
// in Zig for arbitrary clipboard content is fragile (quotes, newlines, NUL,
// non-utf8). Letting JS pull the text via the existing clipboard binding
// keeps the dispatch path string-free.

const std = @import("std");
const c = @import("../c.zig").imports;
const HostContext = @import("../host_context.zig");
const v8_runtime = @import("../v8_runtime.zig");

const POLL_MS: u32 = 250;

var accum_ms: u32 = 0;
var last_hash: u64 = 0;
var initialized: bool = false;

pub fn init() void {
    initialized = false;
    accum_ms = 0;
    last_hash = 0;
}

pub fn tick(host: *HostContext, dt_ms: u32) void {
    accum_ms += dt_ms;
    if (accum_ms < POLL_MS) return;
    accum_ms = 0;

    const ptr = c.SDL_GetClipboardText();
    if (ptr == null) {
        // SDL allocates even on error — free if non-null.
        return;
    }
    defer c.SDL_free(@ptrCast(@constCast(ptr)));

    const text = std.mem.span(ptr);
    const hash = std.hash.Wyhash.hash(0, text);

    // Initial sample — establish baseline without firing.
    if (!initialized) {
        initialized = true;
        last_hash = hash;
        return;
    }

    if (hash == last_hash) return;
    last_hash = hash;

    // Fire JS handler. Handler reads live text via clipboard.get().
    v8_runtime.callGlobal(host, "__beginJsEvent");
    v8_runtime.evalExpr(host, "__ifttt_onClipboardChange()");
    v8_runtime.callGlobal(host, "__endJsEvent");
}
