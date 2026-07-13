//! editor_bus.zig — the AUTHORING eventbus session stream.
//!
//! This is workstream A of the editor foundation. It is the Zig authority behind
//! the `runtime/editorbus/` TS door (`bus.ts` + `event.ts`). Do NOT confuse it
//! with `framework/diag/event_bus.zig` — that one is fire-and-forget observability
//! (sampled, importance-gated, drop-on-overflow). THIS stream is an ordered,
//! bounded process-session record where every accepted outcome gets an
//! authoritative monotonic `seq`.
//!
//! It is deliberately NOT durable application state, document autosave, or undo
//! history. A cold process starts empty; a V8 hot reload keeps the stream because
//! the Zig host remains alive; process exit discards it. Documents own their own
//! explicit-save/autosave persistence.
//!
//! Multiplayer-shaped: an event carries a producing-peer `origin` and the bus
//! stamps an authoritative `seq`. Two peers' events interleave deterministically
//! by `seq`, so the same log replays identically on every machine.
//!
//! Contract (mirrors runtime/editorbus/bus.ts):
//!   append(envelope_json) -> seq   Parse the JSON envelope, stamp an authoritative
//!                                   monotonic `seq` (overwriting the SEQ_PENDING the
//!                                   client sent), retain it, and fan the CONFIRMED
//!                                   envelope back to JS on the `editor.bus` channel
//!                                   (via the installed broadcaster → host __ffiEmit).
//!                                   Returns the assigned seq, or -1 on rejection.
//!   since(afterSeq) -> json        JSON array of confirmed envelopes with seq > afterSeq,
//!                                   oldest-first — for catch-up / replay.
//!   head() -> seq                  Highest committed seq (0 when empty).
//!
//! Storage:
//!   - Bounded in-memory ring of confirmed envelopes for this process session.
//!   - No disk store and no cross-process replay.
//!
//! Single-writer discipline: the main (V8) thread owns this. No locks.

const std = @import("std");

const alloc = std.heap.c_allocator;

/// The ffi channel confirmed envelopes are re-broadcast on. MUST match
/// `EDITOR_BUS_CHANNEL` in runtime/editorbus/bus.ts.
pub const CHANNEL = "editor.bus";

/// Session replay window. This is intentionally bounded so instrumentation cannot
/// grow without limit during a long editor process.
const RING_SIZE: usize = 8192;

/// A confirmed event held in the ring: its authoritative seq + the full,
/// seq-stamped JSON envelope (owned).
const RingEntry = struct {
    seq: i64 = 0,
    json: []u8 = &.{},
};

var g_inited: bool = false;
/// The authoritative monotonic counter. Next seq to assign. Starts at 1 (seq 0
/// means "empty" per the head() contract). It resets on every cold process.
var g_next_seq: i64 = 1;

var g_ring: [RING_SIZE]RingEntry = undefined;
var g_ring_inited: bool = false;
var g_ring_count: u64 = 0;

/// Confirmed-event broadcaster. The V8 binding installs one that calls the host's
/// `__ffiEmit(CHANNEL, json)`. Kept as a function pointer so this core module has
/// ZERO dependency on v8 — it compiles & unit-tests fully headless.
pub const Broadcaster = *const fn (json: []const u8) void;
var g_broadcaster: ?Broadcaster = null;

pub fn setBroadcaster(bc: Broadcaster) void {
    g_broadcaster = bc;
}

pub fn isInitialized() bool {
    return g_inited;
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/// Initialize the bus. Idempotent. Safe to call before any cart code runs.
/// The idempotence is what carries the same session through a V8 hot reload.
pub fn init() void {
    if (g_inited) return;
    for (&g_ring) |*e| e.* = .{};
    g_ring_inited = true;
    g_ring_count = 0;
    g_next_seq = 1;
    g_inited = true;
}

/// Test-only fresh init retained as an explicit fixture boundary.
pub fn initInMemoryForTest() void {
    deinit();
    g_broadcaster = null;
    init();
}

pub fn deinit() void {
    if (!g_inited) return;
    if (g_ring_inited) {
        for (&g_ring) |*e| {
            if (e.json.len > 0) alloc.free(e.json);
            e.* = .{};
        }
        g_ring_inited = false;
    }
    g_ring_count = 0;
    g_inited = false;
}

// ── Append ──────────────────────────────────────────────────────────────

/// Append one authoring event. Parses the JSON envelope, stamps the
/// authoritative seq, retains the confirmed envelope, and fans it out
/// on CHANNEL. Returns the assigned seq, or -1 if the bus is uninitialized or the
/// payload is not a well-formed common event envelope. Domain payload schemas
/// stay above this storage boundary; this validates only the fields shared by
/// every legacy receipt and future command outcome.
pub fn append(envelope_json: []const u8) i64 {
    if (!g_inited) return -1;

    var parsed = std.json.parseFromSlice(std.json.Value, alloc, envelope_json, .{}) catch return -1;
    defer parsed.deinit();
    if (!validEnvelope(parsed.value)) return -1;

    const seq = g_next_seq;
    // Overwrite the client's SEQ_PENDING (-1) with the authoritative order.
    parsed.value.object.put("seq", .{ .integer = seq }) catch return -1;

    const confirmed = std.json.Stringify.valueAlloc(alloc, parsed.value, .{}) catch return -1;
    // `confirmed` ownership transfers to the ring (ringPush). It stays valid for
    // the broadcast below, which runs before the next append can replace its slot.

    g_next_seq = seq + 1;

    ringPush(seq, confirmed);

    if (g_broadcaster) |bc| bc(confirmed);

    return seq;
}

/// Push a confirmed envelope into the ring (takes ownership of `json`).
fn ringPush(seq: i64, json: []u8) void {
    if (!g_ring_inited) {
        // No ring (shouldn't happen post-init) — don't leak.
        alloc.free(json);
        return;
    }
    const slot: usize = @intCast(g_ring_count % RING_SIZE);
    const e = &g_ring[slot];
    if (e.json.len > 0) alloc.free(e.json);
    e.* = .{ .seq = seq, .json = json };
    g_ring_count += 1;
}

// ── Query ───────────────────────────────────────────────────────────────

/// Highest committed seq (0 when empty). Cheap, in-memory.
pub fn head() i64 {
    return g_next_seq - 1;
}

/// JSON array of confirmed envelopes with seq > after_seq, oldest-first.
/// Events older than the bounded session ring are intentionally unavailable.
/// Caller owns the returned slice.
pub fn since(allocator: std.mem.Allocator, after_seq: i64) ![]u8 {
    return sinceFromRing(allocator, after_seq);
}

fn sinceFromRing(allocator: std.mem.Allocator, after_seq: i64) ![]u8 {
    var out: std.ArrayList(u8) = .{};
    errdefer out.deinit(allocator);
    try out.append(allocator, '[');
    if (g_ring_inited and g_ring_count > 0) {
        const live: u64 = @min(g_ring_count, RING_SIZE);
        const start = g_ring_count - live;
        var first = true;
        var i: u64 = start;
        while (i < g_ring_count) : (i += 1) {
            const slot: usize = @intCast(i % RING_SIZE);
            const e = &g_ring[slot];
            if (e.json.len == 0 or e.seq <= after_seq) continue;
            if (!first) try out.append(allocator, ',');
            first = false;
            try out.appendSlice(allocator, e.json);
        }
    }
    try out.append(allocator, ']');
    return out.toOwnedSlice(allocator);
}

// ── JSON field helpers ──────────────────────────────────────────────────

fn strField(v: std.json.Value, key: []const u8) ?[]const u8 {
    if (v != .object) return null;
    const got = v.object.get(key) orelse return null;
    return switch (got) {
        .string => |s| s,
        else => null,
    };
}

fn validEnvelope(v: std.json.Value) bool {
    if (v != .object) return false;

    const origin = strField(v, "origin") orelse return false;
    if (origin.len == 0) return false;

    const event_type = strField(v, "type") orelse return false;
    if (event_type.len == 0) return false;

    const ts = v.object.get("ts") orelse return false;
    if (ts != .integer) return false;

    const targets = v.object.get("targets") orelse return false;
    if (targets != .array) return false;

    const payload = v.object.get("payload") orelse return false;
    if (payload != .object) return false;

    return true;
}
