//! latches.zig — host-owned animated values readable by layout.
//!
//! Port of love2d/lua/latches.lua → archive/tsz-gen/runtime/tsz/latches.mod.tsz
//! → here. Same shape, hand-translated to Zig because the tsz compiler
//! that produced the archived `compiled/latches.zig` is frozen.
//!
//! A latch is a named f64 value the host stores. Cart code writes via
//! `__latchSet(key, value)` from V8; layout reads via `latches.get(key)`
//! at frame time. The point: animation drivers can mutate paint-relevant
//! values without going through React reconciliation, JSON serialization,
//! the FFI bridge once per op, or `applyCommand` parsing. One FFI call
//! per latch write, no JSON, no vdom diff.
//!
//! Used together with `<Box style={{ height: "latch:bar:0:height" }}>`
//! style-prop binding tokens (resolved in v8_app.zig:applyStyle, mirroring
//! the existing `theme:NAME` resolver).
//!
//! ── Why this isn't a HashMap ────────────────────────────────────────
//! Linear scan in `findEntry` is O(N) but N is small (tens to hundreds
//! per page, sometimes a couple thousand) and cache-friendly. The
//! archived design used 256 / 128. Bumped to 4096 / 128 for Bloomberg-
//! grade ticker grids.

const std = @import("std");

// Matches MAX_ANIMS in framework/animations.zig — host-driven anims
// each write to one latch, so the two pools should grow together.
const MAX_LATCHES: usize = 8192;
const MAX_KEY_LEN: usize = 128;

const LatchEntry = struct {
    key_buf: [MAX_KEY_LEN]u8 = [_]u8{0} ** MAX_KEY_LEN,
    key_len: u8 = 0,
    value: f64 = 0,
    active: bool = false,
};

var entries: [MAX_LATCHES]LatchEntry = [_]LatchEntry{.{}} ** MAX_LATCHES;
var entry_count: usize = 0;

/// Set true on every `set()`; the host's frame loop reads + clears this
/// to know whether layout/paint must re-run. Cheaper than per-node dirty
/// stamping when the cart is animating many latches at once — one global
/// bit flips, the framework's existing `g_dirty` path handles the rest.
var has_dirty: bool = false;

fn findEntry(key: []const u8) ?usize {
    var i: usize = 0;
    while (i < entry_count) : (i += 1) {
        const e = &entries[i];
        if (e.active and e.key_len == key.len and std.mem.eql(u8, e.key_buf[0..e.key_len], key)) {
            return i;
        }
    }
    return null;
}

fn findOrCreate(key: []const u8) ?usize {
    if (findEntry(key)) |idx| return idx;
    if (entry_count >= MAX_LATCHES) return null;
    const idx = entry_count;
    const len: u8 = @intCast(@min(key.len, MAX_KEY_LEN));
    @memcpy(entries[idx].key_buf[0..len], key[0..len]);
    entries[idx].key_len = len;
    entries[idx].value = 0;
    entries[idx].active = true;
    entry_count += 1;
    return idx;
}

/// Write a latch value. Marks the dirty flag so the host's frame loop
/// triggers a re-layout/repaint. No-op if the pool is full.
pub fn set(key: []const u8, value: f64) void {
    if (findOrCreate(key)) |idx| {
        entries[idx].value = value;
        has_dirty = true;
    }
}

/// Read a latch value. Returns 0 if the key has never been written.
pub fn get(key: []const u8) f64 {
    if (findEntry(key)) |idx| return entries[idx].value;
    return 0;
}

/// Read a latch as f32 — convenience for layout, which uses f32
/// throughout. 0 if missing.
pub fn getF32(key: []const u8) f32 {
    if (findEntry(key)) |idx| return @floatCast(entries[idx].value);
    return 0;
}

/// True iff the key has been written at least once.
pub fn exists(key: []const u8) bool {
    return findEntry(key) != null;
}

/// Has at least one latch been written since the last `clearDirty`?
pub fn isDirty() bool {
    return has_dirty;
}

/// Clear the global dirty flag. Called from the host frame loop after
/// the dirty bit has triggered a re-layout/paint.
pub fn clearDirty() void {
    has_dirty = false;
}

/// Wipe all latch state. Called on dev hot-reload alongside the rest of
/// the per-tree clear paths in v8_app.zig:clearTreeStateForReload.
pub fn clearAll() void {
    var i: usize = 0;
    while (i < entry_count) : (i += 1) {
        entries[i].active = false;
        entries[i].key_len = 0;
        entries[i].value = 0;
    }
    entry_count = 0;
    has_dirty = false;
}

pub fn count() usize {
    return entry_count;
}
