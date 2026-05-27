//! framework/v8_bindings_reconciler.zig — the single owner of the
//! `__hostFlush` v8 binding. The React reconciler (renderer/hostConfig.ts)
//! emits a JSON array of CREATE/APPEND/UPDATE/REMOVE mutations per commit
//! and calls `__hostFlush(jsonString)` from JS. This file is the only
//! place that registration lives; both the GPU shell (v8_app.zig) and the
//! TUI shell (v8_tui_app.zig) pull it in.
//!
//! The capability ("apply a mutation batch to the host tree") is shape-
//! agnostic — same JSON, same host_tree.zig consumer. What differs across
//! shells is *when* the apply runs:
//!
//!   - TUI (`.sync` mode, default): apply inline inside the host-fn
//!     callback. There's no Zig-side paint loop to coordinate with.
//!
//!   - GPU (`.queue` mode, set by v8_app at startup): enqueue the
//!     payload; the engine drains the queue at the start of its
//!     paint frame via `drainPending()`. Decoupling reconciler commits
//!     from the GPU frame phase keeps tree mutations from landing
//!     mid-paint.
//!
//! Replaces the previous split where v8_bindings_core.zig + v8_bindings_host_window.zig
//! each registered their own `__hostFlush` against different applyCommand
//! implementations.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const host_tree = @import("host_tree.zig");
const event_bus = @import("diag/event_bus.zig");

pub const Mode = enum { sync, queue };

var g_mode: Mode = .sync;
var g_pending: std.ArrayList([]u8) = .{};

pub fn setMode(mode: Mode) void {
    g_mode = mode;
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

fn hostFlush(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const payload = argToStringAlloc(info, 0) orelse return;

    // host.flush fires per React commit — that's hundreds-thousands per
    // second on a busy cart, and persisting that to SQL bloats the events
    // table catastrophically (12hr session = 2.4GB observed). Per-frame
    // commit telemetry belongs in framework/telemetry.zig (snapshot
    // counters), not in event_bus (append stream). The outlier emit below
    // — large flushes — is rare enough to be worth keeping as a real
    // event you'd want to see.
    if (payload.len >= 256 * 1024) {
        var pbuf: [64]u8 = undefined;
        if (std.fmt.bufPrint(&pbuf, "{{\"bytes\":{d}}}", .{payload.len})) |p| {
            _ = event_bus.emitWithImportance("host.flush.large", "v8_bindings_reconciler", 0.7, null, p);
        } else |_| {}
    }

    switch (g_mode) {
        .sync => {
            defer std.heap.c_allocator.free(payload);
            host_tree.applyCommandBatch(payload);
        },
        .queue => {
            g_pending.append(std.heap.c_allocator, payload) catch {
                std.heap.c_allocator.free(payload);
            };
        },
    }
}

/// Drain queued batches in arrival order. The supplied `apply` consumes
/// each batch's bytes — the GPU shell hands in its own per-batch routine
/// (which forwards to host_tree.applyCommandBatch plus per-batch
/// diagnostics + IPC forwarding to .independent windows). Each batch's
/// memory is freed after the call.
pub const ApplyFn = *const fn (bytes: []const u8) void;

pub fn drainPending(apply: ApplyFn) void {
    if (g_pending.items.len == 0) return;
    const batches = g_pending.toOwnedSlice(std.heap.c_allocator) catch return;
    defer {
        for (batches) |b| std.heap.c_allocator.free(b);
        std.heap.c_allocator.free(batches);
    }
    for (batches) |b| apply(b);
}

/// Discard queued batches without applying. The dev-mode reload path
/// calls this AFTER wiping the tree but BEFORE the new bundle eval'd:
/// commands queued by the prior bundle reference node IDs that were
/// just freed; replaying them on top of a fresh React mount produces
/// parent/child cycles and infinite recursion in materializeChildren.
pub fn clearPending() void {
    for (g_pending.items) |b| std.heap.c_allocator.free(b);
    g_pending.clearRetainingCapacity();
}

pub fn register() void {
    v8_runtime.registerHostFn("__hostFlush", hostFlush);
}
