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
const host_io = @import("host_io.zig");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const host_tree = @import("host_tree.zig");
const event_bus = @import("diag/event_bus.zig");

pub const Mode = enum { sync, queue };

pub const Telemetry = struct {
    queued_batches: u32 = 0,
    queued_bytes: u64 = 0,
    last_drain_batches: u32 = 0,
    last_drain_bytes: u64 = 0,
    last_drain_us: u64 = 0,
    total_enqueued_batches: u64 = 0,
    total_enqueued_bytes: u64 = 0,
    total_drained_batches: u64 = 0,
    total_drained_bytes: u64 = 0,
};

var g_mode: Mode = .sync;
var g_pending: std.ArrayList([]u8) = .{};
var g_pending_bytes: u64 = 0;
var g_last_drain_batches: u32 = 0;
var g_last_drain_bytes: u64 = 0;
var g_last_drain_us: u64 = 0;
var g_total_enqueued_batches: u64 = 0;
var g_total_enqueued_bytes: u64 = 0;
var g_total_drained_batches: u64 = 0;
var g_total_drained_bytes: u64 = 0;

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
            const t0 = host_io.microTimestamp();
            host_tree.applyCommandBatch(payload);
            const t1 = host_io.microTimestamp();
            g_last_drain_batches = 1;
            g_last_drain_bytes = @intCast(payload.len);
            g_last_drain_us = @intCast(@max(0, t1 - t0));
            g_total_enqueued_batches += 1;
            g_total_enqueued_bytes += payload.len;
            g_total_drained_batches += 1;
            g_total_drained_bytes += payload.len;
        },
        .queue => {
            g_pending.append(std.heap.c_allocator, payload) catch {
                std.heap.c_allocator.free(payload);
                return;
            };
            g_pending_bytes += payload.len;
            g_total_enqueued_batches += 1;
            g_total_enqueued_bytes += payload.len;
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
    if (g_pending.items.len == 0) {
        g_last_drain_batches = 0;
        g_last_drain_bytes = 0;
        g_last_drain_us = 0;
        return;
    }
    const batch_count: u32 = @intCast(@min(g_pending.items.len, std.math.maxInt(u32)));
    const byte_count = g_pending_bytes;
    const batches = g_pending.toOwnedSlice(std.heap.c_allocator) catch return;
    g_pending_bytes = 0;
    const t0 = host_io.microTimestamp();
    defer {
        for (batches) |b| std.heap.c_allocator.free(b);
        std.heap.c_allocator.free(batches);
    }
    for (batches) |b| apply(b);
    const t1 = host_io.microTimestamp();
    g_last_drain_batches = batch_count;
    g_last_drain_bytes = byte_count;
    g_last_drain_us = @intCast(@max(0, t1 - t0));
    g_total_drained_batches += batch_count;
    g_total_drained_bytes += byte_count;
}

/// Discard queued batches without applying. The dev-mode reload path
/// calls this AFTER wiping the tree but BEFORE the new bundle eval'd:
/// commands queued by the prior bundle reference node IDs that were
/// just freed; replaying them on top of a fresh React mount produces
/// parent/child cycles and infinite recursion in materializeChildren.
pub fn clearPending() void {
    for (g_pending.items) |b| std.heap.c_allocator.free(b);
    g_pending.clearRetainingCapacity();
    g_pending_bytes = 0;
    g_last_drain_batches = 0;
    g_last_drain_bytes = 0;
    g_last_drain_us = 0;
}

pub fn telemetrySnapshot() Telemetry {
    return .{
        .queued_batches = @intCast(@min(g_pending.items.len, std.math.maxInt(u32))),
        .queued_bytes = g_pending_bytes,
        .last_drain_batches = g_last_drain_batches,
        .last_drain_bytes = g_last_drain_bytes,
        .last_drain_us = g_last_drain_us,
        .total_enqueued_batches = g_total_enqueued_batches,
        .total_enqueued_bytes = g_total_enqueued_bytes,
        .total_drained_batches = g_total_drained_batches,
        .total_drained_bytes = g_total_drained_bytes,
    };
}

pub fn register() void {
    v8_runtime.registerHostFn("__hostFlush", hostFlush);
}
