// ifttt_zig.zig — Zig-side state for useIFTTT.
//
// Three responsibilities:
//   1. Wire registry — every useIFTTT() call allocates a wireId and uses it
//      as a stable handle. Per-wire counters (fired count, lastFiredAt) live
//      here so the JS hook never needs to call setState/forceTick to keep
//      its return value reactive — the cart can read counters via FFI when
//      it wants them, and we don't burn a render every time a key fires.
//   2. Timer wheel — `timer:every:<ms>` and `timer:once:<ms>` previously
//      used JS setInterval/setTimeout. They now live here, ticked from the
//      engine frame loop. Cadence is frame-quantized (no shorter than ~16ms)
//      and immune to V8 GC pauses or reconciler stalls.
//   3. Key match registry — `key:<spec>` / `key:up:<spec>` triggers
//      pre-compile their (sym, modifier-want) tuple at register time.
//      On keydown/keyup, the engine walks this list directly in Zig and
//      only crosses the JS bridge for matching subscribers. Eliminates the
//      "every keystroke runs N JS string-compares" overhead.
//
// JS callbacks: when a wired trigger fires (timer or key), we call the
// JS-side dispatcher __ifttt_dispatch_timer(wireId) / __ifttt_dispatch_key
// (wireId). The hook's actionRef is JS-only — we don't try to own action
// callbacks here.

const std = @import("std");
const v8_runtime = @import("../v8_runtime.zig");
const key_pack = @import("../key_pack.zig");

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

var wires: std.ArrayList(WireRow) = .empty;
var timers: std.ArrayList(Timer) = .empty;
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

// ── Key match registry ───────────────────────────────────────────────────
//
// Each `key:<spec>` / `key:up:<spec>` trigger pre-compiles the SDL
// keycode (sym) plus the four modifier wants at register time. On every
// keydown/keyup, engine.zig calls dispatchKeyDown/dispatchKeyUp and we
// walk this list, only crossing the JS bridge once per matching wire.
// Today's JS path decoded the packed key, emitted to the bus, and ran
// every `key:`-source subscriber's `keyMatches(ev, spec)` check per
// keystroke — an O(N) JS scan; here it's an O(N) Zig integer compare.

const SDL_KMOD_SHIFT: u32 = 0x0003;
const SDL_KMOD_CTRL: u32 = 0x00C0;
const SDL_KMOD_ALT: u32 = 0x0300;
const SDL_KMOD_GUI: u32 = 0x0C00;

const KeyMatch = struct {
    id: u32,
    sym: u32,
    want_ctrl: bool,
    want_shift: bool,
    want_alt: bool,
    want_meta: bool,
    is_keyup: bool,
    dispatch_wire: u32,
    alive: bool,
};

var key_matches: std.ArrayList(KeyMatch) = .empty;
var next_key_id: u32 = 1;
var last_dispatched_key: i64 = 0;

pub fn keyRegister(
    sym: u32,
    want_ctrl: bool,
    want_shift: bool,
    want_alt: bool,
    want_meta: bool,
    is_keyup: bool,
    dispatch_wire: u32,
) u32 {
    const id = next_key_id;
    next_key_id += 1;
    key_matches.append(alloc, .{
        .id = id,
        .sym = sym,
        .want_ctrl = want_ctrl,
        .want_shift = want_shift,
        .want_alt = want_alt,
        .want_meta = want_meta,
        .is_keyup = is_keyup,
        .dispatch_wire = dispatch_wire,
        .alive = true,
    }) catch return 0;
    return id;
}

pub fn keyUnregister(id: u32) void {
    if (id == 0) return;
    for (key_matches.items) |*k| {
        if (k.id == id) {
            k.alive = false;
            return;
        }
    }
}

/// Last keystroke dispatched. The JS-side dispatcher reads this via
/// __ifttt_last_key() to decode the friendly event payload — saves
/// passing two ints through callGlobalInt.
pub fn lastDispatchedKey() i64 {
    return last_dispatched_key;
}

fn dispatchKey(packed_key: i64, is_keyup: bool) void {
    // Full-width (mod << 32 | sym) layout — see framework/key_pack.zig.
    const sym: u32 = key_pack.symOf(packed_key);
    const mod: u32 = key_pack.modOf(packed_key);
    const has_ctrl = (mod & SDL_KMOD_CTRL) != 0;
    const has_shift = (mod & SDL_KMOD_SHIFT) != 0;
    const has_alt = (mod & SDL_KMOD_ALT) != 0;
    const has_meta = (mod & SDL_KMOD_GUI) != 0;

    last_dispatched_key = packed_key;

    var fired_any = false;
    // Snapshot length so re-entry from JS (a key handler that registers
    // another key) doesn't extend our scan window mid-walk.
    const n = key_matches.items.len;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const k = key_matches.items[i];
        if (!k.alive) continue;
        if (k.is_keyup != is_keyup) continue;
        if (k.sym != sym) continue;
        if (k.want_ctrl != has_ctrl) continue;
        if (k.want_shift != has_shift) continue;
        if (k.want_alt != has_alt) continue;
        if (k.want_meta != has_meta) continue;
        if (!fired_any) {
            v8_runtime.callGlobal("__beginJsEvent");
            fired_any = true;
        }
        v8_runtime.callGlobalInt("__ifttt_dispatch_key", @intCast(k.dispatch_wire));
    }
    if (fired_any) v8_runtime.callGlobal("__endJsEvent");
}

pub fn dispatchKeyDown(packed_key: i64) void {
    dispatchKey(packed_key, false);
}
pub fn dispatchKeyUp(packed_key: i64) void {
    dispatchKey(packed_key, true);
}

fn compactKeyMatches() void {
    var write: usize = 0;
    for (key_matches.items) |k| {
        if (k.alive) {
            key_matches.items[write] = k;
            write += 1;
        }
    }
    key_matches.shrinkRetainingCapacity(write);
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
    // for the small N we expect (dozens of wires, a handful of timers,
    // dozens of key matches).
    if (timers.items.len > 32) compactTimers();
    if (wires.items.len > 64) compactWires();
    if (key_matches.items.len > 64) compactKeyMatches();
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
