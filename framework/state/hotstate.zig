//! hotstate.zig — in-process atom store that survives QuickJS teardowns.
//!
//! Dev-mode hot reload kills the JS world (the QJS ctx + Node pool + all React
//! state). But the Zig process persists across reloads. This module is the
//! persistence layer: a key→JSON-string map that useHotState writes to on
//! every setState and reads from on first render after a reload.
//!
//! Values are stored as raw JSON text (whatever the JS caller stringified) so
//! the hook can JSON.parse it back without us needing to know the shape.
//!
//! Thread-safety: single-threaded. The JS bridge is main-thread only.

const std = @import("std");

const Map = std.StringHashMap([]u8);

var g_map: ?Map = null;
var g_alloc: std.mem.Allocator = std.heap.page_allocator;

fn ensureInit() *Map {
    if (g_map == null) g_map = Map.init(g_alloc);
    return &g_map.?;
}

/// Get the JSON-string value for `key`, or null if missing. Caller must NOT
/// free the returned slice — it's owned by the map.
pub fn get(key: []const u8) ?[]const u8 {
    const map = ensureInit();
    return map.get(key);
}

/// Store `json_value` under `key`, replacing any prior value. Copies both
/// key and value into the map's own memory.
pub fn set(key: []const u8, json_value: []const u8) void {
    const map = ensureInit();
    if (map.getEntry(key)) |entry| {
        // Same key exists — free old value, write new one in place
        g_alloc.free(entry.value_ptr.*);
        entry.value_ptr.* = g_alloc.dupe(u8, json_value) catch return;
        return;
    }
    const key_copy = g_alloc.dupe(u8, key) catch return;
    const val_copy = g_alloc.dupe(u8, json_value) catch {
        g_alloc.free(key_copy);
        return;
    };
    map.put(key_copy, val_copy) catch {
        g_alloc.free(key_copy);
        g_alloc.free(val_copy);
    };
}

/// Remove a key. No-op if missing.
pub fn remove(key: []const u8) void {
    const map = ensureInit();
    if (map.fetchRemove(key)) |kv| {
        g_alloc.free(kv.key);
        g_alloc.free(kv.value);
    }
}

/// Wipe everything. Frees all key and value storage.
pub fn clear() void {
    const map = ensureInit();
    var it = map.iterator();
    while (it.next()) |entry| {
        g_alloc.free(entry.key_ptr.*);
        g_alloc.free(entry.value_ptr.*);
    }
    map.clearRetainingCapacity();
}

/// Return a JSON array of all keys. Caller owns the returned slice.
pub fn keysJson(alloc: std.mem.Allocator) ![]u8 {
    const map = ensureInit();
    var out = std.ArrayList(u8){};
    errdefer out.deinit(alloc);
    try out.append(alloc, '[');
    var first = true;
    var it = map.keyIterator();
    while (it.next()) |k| {
        if (!first) try out.append(alloc, ',');
        first = false;
        try out.append(alloc, '"');
        for (k.*) |ch| switch (ch) {
            '"' => try out.appendSlice(alloc, "\\\""),
            '\\' => try out.appendSlice(alloc, "\\\\"),
            '\n' => try out.appendSlice(alloc, "\\n"),
            '\r' => try out.appendSlice(alloc, "\\r"),
            '\t' => try out.appendSlice(alloc, "\\t"),
            0...8, 11, 12, 14...31 => try out.writer(alloc).print("\\u{x:0>4}", .{ch}),
            else => try out.append(alloc, ch),
        };
        try out.append(alloc, '"');
    }
    try out.append(alloc, ']');
    return out.toOwnedSlice(alloc);
}

pub fn count() usize {
    const map = ensureInit();
    return map.count();
}
