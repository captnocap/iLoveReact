// ifttt_zig.zig — Zig-side state for useIFTTT.
//
// Two responsibilities:
//   1. Wire registry — every useIFTTT() call allocates a wireId and uses it
//      as a stable handle. Per-wire counters (fired count, lastFiredAt) live
//      here so the JS hook never needs to call setState/forceTick to keep
//      its return value reactive — the cart can read counters via FFI when
//      it wants them, and we don't burn a render every time a key fires.
//   2. Timer wheel — `timer:every:<ms>` and `timer:once:<ms>` previously
//      used JS setInterval/setTimeout. They now live here, ticked from the
//      engine frame loop. Cadence is frame-quantized (no shorter than ~16ms)
//      and immune to V8 GC pauses or reconciler stalls.
//
// JS callbacks: when a timer fires, we call the JS-side dispatcher
// __ifttt_dispatch_timer(wireId). The hook's actionRef is JS-only — we
// don't try to own action callbacks here.

const std = @import("std");
const v8_runtime = @import("v8_runtime.zig");

const alloc = std.heap.c_allocator;

const WireRow = struct {
    id: u32,
    fired: u32 = 0,
    last_at_ms: f64 = 0,
    alive: bool = true,
};

const Timer = struct {
    id: u32,
    wire_id: u32,
    every_ms: u32,
    next_at_ms: u64,
    once: bool,
    alive: bool,
};

var wires: std.ArrayList(WireRow) = .{};
var timers: std.ArrayList(Timer) = .{};
var next_wire_id: u32 = 1;
var next_timer_id: u32 = 1;
var clock_ms: u64 = 0;

// ── Wire registry ────────────────────────────────────────────────────────

pub fn wireAlloc() u32 {
    const id = next_wire_id;
    next_wire_id += 1;
    wires.append(alloc, .{ .id = id }) catch return 0;
    return id;
}

pub fn wireFree(id: u32) void {
    if (id == 0) return;
    for (wires.items) |*w| {
        if (w.id == id) {
            w.alive = false;
            return;
        }
    }
}

pub fn wireBump(id: u32, now_ms: f64) void {
    if (id == 0) return;
    for (wires.items) |*w| {
        if (w.id == id and w.alive) {
            w.fired +%= 1;
            w.last_at_ms = now_ms;
            return;
        }
    }
}

pub fn wireCount(id: u32) u32 {
    for (wires.items) |w| {
        if (w.id == id) return w.fired;
    }
    return 0;
}

pub fn wireLastAt(id: u32) f64 {
    for (wires.items) |w| {
        if (w.id == id) return w.last_at_ms;
    }
    return 0;
}

// ── Timer wheel ──────────────────────────────────────────────────────────

pub fn timerRegister(every_ms: u32, once: bool, wire_id: u32) u32 {
    const ms = if (every_ms == 0) 1 else every_ms;
    const id = next_timer_id;
    next_timer_id += 1;
    timers.append(alloc, .{
        .id = id,
        .wire_id = wire_id,
        .every_ms = ms,
        .next_at_ms = clock_ms + ms,
        .once = once,
        .alive = true,
    }) catch return 0;
    return id;
}

pub fn timerCancel(id: u32) void {
    if (id == 0) return;
    for (timers.items) |*t| {
        if (t.id == id) {
            t.alive = false;
            return;
        }
    }
}

pub fn tick(dt_ms: u32) void {
    clock_ms += dt_ms;

    // Fire any due timers. Snapshot length so re-entry from JS dispatch
    // (which could register a new timer) doesn't trip the iterator.
    const n = timers.items.len;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        var t = &timers.items[i];
        if (!t.alive) continue;
        if (t.next_at_ms > clock_ms) continue;

        const wire = t.wire_id;
        if (t.once) {
            t.alive = false;
        } else {
            // Catch up if frame skipped: jump to first future slot.
            t.next_at_ms += t.every_ms;
            if (t.next_at_ms <= clock_ms) {
                const behind = clock_ms - t.next_at_ms;
                const skips = behind / t.every_ms + 1;
                t.next_at_ms += t.every_ms * skips;
            }
        }

        v8_runtime.callGlobal("__beginJsEvent");
        v8_runtime.callGlobalInt("__ifttt_dispatch_timer", @intCast(wire));
        v8_runtime.callGlobal("__endJsEvent");
    }

    // Compact dead rows occasionally to keep the lists bounded. Cheap
    // for the small N we expect (dozens of wires, a handful of timers).
    if (timers.items.len > 32) compactTimers();
    if (wires.items.len > 64) compactWires();
}

fn compactTimers() void {
    var write: usize = 0;
    for (timers.items) |t| {
        if (t.alive) {
            timers.items[write] = t;
            write += 1;
        }
    }
    timers.shrinkRetainingCapacity(write);
}

fn compactWires() void {
    var write: usize = 0;
    for (wires.items) |w| {
        if (w.alive) {
            wires.items[write] = w;
            write += 1;
        }
    }
    wires.shrinkRetainingCapacity(write);
}
