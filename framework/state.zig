//! ReactJIT State System — Task 1: State & Reactivity
//!
//! Each useState() call in .tsz gets a slot ID at compile time.
//! State changes mark dirty, which triggers tree rebuild + re-layout
//! + repaint in the main loop.
//!
//! Array state uses heap-allocated (page_allocator) growable storage.
//! No fixed element ceilings — arrays grow as needed.

const std = @import("std");
const log = @import("diag/log.zig");
const layout = @import("layout.zig");

pub const MAX_SLOTS = 512;

const alloc = std.heap.page_allocator;

// ── Array state ─────────────────────────────────────────────────────────

const ARRAY_INITIAL_CAP = 64;
const MAX_ARRAY_SLOTS = 64;

pub const ArraySlot = struct {
    values: []i64,
    capacity: usize,
    count: usize,
    dirty: bool,

    pub fn ensureCapacity(self: *ArraySlot, needed: usize) void {
        if (needed <= self.capacity) return;
        const new_cap = @max(needed, self.capacity * 2, ARRAY_INITIAL_CAP);
        if (self.capacity == 0) {
            self.values = alloc.alloc(i64, new_cap) catch return;
            @memset(self.values, 0);
        } else {
            const old = self.values.ptr[0..self.capacity];
            self.values = alloc.realloc(old, new_cap) catch return;
            // Zero new region
            @memset(self.values[self.capacity..new_cap], 0);
        }
        self.capacity = new_cap;
    }
};

var array_slots: [MAX_ARRAY_SLOTS]ArraySlot = [_]ArraySlot{.{
    .values = &[_]i64{},
    .capacity = 0,
    .count = 0,
    .dirty = false,
}} ** MAX_ARRAY_SLOTS;
var array_slot_count: usize = 0;

// ── String array state ──────────────────────────────────────────────────

const MAX_STR_ARRAY_SLOTS = 32;
pub const STR_ELEM_BUF_SIZE = 512;

pub const StringArraySlot = struct {
    bufs: [][STR_ELEM_BUF_SIZE]u8,
    lens: []u16,
    capacity: usize,
    count: usize,
    dirty: bool,

    pub fn ensureCapacity(self: *StringArraySlot, needed: usize) void {
        if (needed <= self.capacity) return;
        const new_cap = @max(needed, self.capacity * 2, ARRAY_INITIAL_CAP);
        if (self.capacity == 0) {
            self.bufs = alloc.alloc([STR_ELEM_BUF_SIZE]u8, new_cap) catch return;
            self.lens = alloc.alloc(u16, new_cap) catch return;
            @memset(self.lens, 0);
        } else {
            const old_bufs = self.bufs.ptr[0..self.capacity];
            self.bufs = alloc.realloc(old_bufs, new_cap) catch return;
            const old_lens = self.lens.ptr[0..self.capacity];
            self.lens = alloc.realloc(old_lens, new_cap) catch return;
            @memset(self.lens[self.capacity..new_cap], 0);
        }
        self.capacity = new_cap;
    }
};

var str_array_slots: [MAX_STR_ARRAY_SLOTS]StringArraySlot = [_]StringArraySlot{.{
    .bufs = &[_][STR_ELEM_BUF_SIZE]u8{},
    .lens = &[_]u16{},
    .capacity = 0,
    .count = 0,
    .dirty = false,
}} ** MAX_STR_ARRAY_SLOTS;
var str_array_slot_count: usize = 0;

/// A state slot holds a tagged union of possible value types.
pub const Value = union(enum) {
    int: i64,
    float: f64,
    boolean: bool,
    // Paths and generated text can easily exceed a tiny inline buffer.
    string: struct { buf: []u8 },
};

pub const StateSlot = struct {
    value: Value,
    dirty: bool,
};

pub const SlotKind = enum {
    int,
    float,
    boolean,
    string,
};

var slots: [MAX_SLOTS]StateSlot = undefined;
var slot_count: usize = 0;
var _dirty: bool = false;

fn dupString(src: []const u8) []u8 {
    return alloc.dupe(u8, src) catch alloc.alloc(u8, 0) catch unreachable;
}

fn releaseValue(value: *Value) void {
    switch (value.*) {
        .string => |s| alloc.free(s.buf),
        else => {},
    }
    value.* = .{ .int = 0 };
}

/// Reserve a contiguous range of slots, all initialized to int(0).
pub fn reserveSlots(count: usize) usize {
    const base = slot_count;
    std.debug.assert(base + count <= MAX_SLOTS);
    for (0..count) |i| {
        slots[base + i] = .{ .value = .{ .int = 0 }, .dirty = false };
    }
    slot_count += count;
    return base;
}

/// Allocate a new state slot with an initial integer value.
pub fn createSlot(initial: i64) usize {
    const id = slot_count;
    std.debug.assert(id < MAX_SLOTS);
    slots[id] = .{
        .value = .{ .int = initial },
        .dirty = false,
    };
    slot_count += 1;
    return id;
}

/// Allocate a new state slot with an initial float value.
pub fn createSlotFloat(initial: f64) usize {
    const id = slot_count;
    std.debug.assert(id < MAX_SLOTS);
    slots[id] = .{
        .value = .{ .float = initial },
        .dirty = false,
    };
    slot_count += 1;
    return id;
}

/// Allocate a new state slot with an initial boolean value.
pub fn createSlotBool(initial: bool) usize {
    const id = slot_count;
    std.debug.assert(id < MAX_SLOTS);
    slots[id] = .{
        .value = .{ .boolean = initial },
        .dirty = false,
    };
    slot_count += 1;
    return id;
}

/// Allocate a new state slot with an initial string value.
pub fn createSlotString(initial: []const u8) usize {
    const id = slot_count;
    std.debug.assert(id < MAX_SLOTS);
    slots[id] = .{
        .value = .{ .string = .{ .buf = dupString(initial) } },
        .dirty = false,
    };
    slot_count += 1;
    return id;
}

/// Read a string state value. Returns empty string for non-string slots.
pub fn getSlotString(id: usize) []const u8 {
    return switch (slots[id].value) {
        .string => |s| s.buf,
        else => "",
    };
}

pub fn getSlotKind(id: usize) SlotKind {
    if (id >= slot_count) return .int;
    return switch (slots[id].value) {
        .int => .int,
        .float => .float,
        .boolean => .boolean,
        .string => .string,
    };
}

/// Set a string state value. Marks dirty if changed.
pub fn setSlotString(id: usize, val: []const u8) void {
    const current = getSlotString(id);
    if (!std.mem.eql(u8, current, val)) {
        log.info(.state, "slot[{d}] string \"{s}\" -> \"{s}\"", .{ id, current, val });
        releaseValue(&slots[id].value);
        slots[id].value = .{ .string = .{ .buf = dupString(val) } };
        slots[id].dirty = true;
        _dirty = true;
        layout.markLayoutDirty();
    }
}

/// Read an integer state value.
pub fn getSlot(id: usize) i64 {
    return switch (slots[id].value) {
        .int => |v| v,
        .float => |v| @intFromFloat(v),
        .boolean => |v| if (v) @as(i64, 1) else 0,
        .string => 0,
    };
}

/// Read a float state value.
pub fn getSlotFloat(id: usize) f64 {
    return switch (slots[id].value) {
        .int => |v| @floatFromInt(v),
        .float => |v| v,
        .boolean => |v| if (v) @as(f64, 1.0) else 0.0,
        .string => 0.0,
    };
}

/// Read a boolean state value.
pub fn getSlotBool(id: usize) bool {
    return switch (slots[id].value) {
        .int => |v| v != 0,
        .float => |v| v != 0.0,
        .boolean => |v| v,
        .string => |s| s.buf.len > 0,
    };
}

/// Set an integer state value. Marks dirty if changed.
pub fn setSlot(id: usize, val: i64) void {
    const current = getSlot(id);
    if (current != val) {
        log.info(.state, "slot[{d}] int {d} -> {d}", .{ id, current, val });
        releaseValue(&slots[id].value);
        slots[id].value = .{ .int = val };
        slots[id].dirty = true;
        _dirty = true;
        layout.markLayoutDirty();
    }
}

/// Set a float state value. Marks dirty if changed.
pub fn setSlotFloat(id: usize, val: f64) void {
    const current = getSlotFloat(id);
    if (current != val) {
        log.info(.state, "slot[{d}] float {d:.4} -> {d:.4}", .{ id, current, val });
        releaseValue(&slots[id].value);
        slots[id].value = .{ .float = val };
        slots[id].dirty = true;
        _dirty = true;
        layout.markLayoutDirty();
    }
}

/// Set a boolean state value. Marks dirty if changed.
pub fn setSlotBool(id: usize, val: bool) void {
    const current = getSlotBool(id);
    if (current != val) {
        log.info(.state, "slot[{d}] bool {any} -> {any}", .{ id, current, val });
        releaseValue(&slots[id].value);
        slots[id].value = .{ .boolean = val };
        slots[id].dirty = true;
        _dirty = true;
        layout.markLayoutDirty();
    }
}

/// Check if a specific slot has changed since last clearDirty().
pub fn slotDirty(id: usize) bool {
    if (id >= slot_count) return false;
    return slots[id].dirty;
}

/// Check if any state has changed since last clearDirty().
pub fn isDirty() bool {
    return _dirty;
}

/// Mark state as dirty (used by generated object array unpack functions).
pub fn markDirty() void {
    _dirty = true;
    layout.markLayoutDirty();
}

/// Clear the dirty flag after rebuilding the tree.
pub fn clearDirty() void {
    for (0..slot_count) |i| {
        slots[i].dirty = false;
    }
    for (0..array_slot_count) |i| {
        array_slots[i].dirty = false;
    }
    for (0..str_array_slot_count) |i| {
        str_array_slots[i].dirty = false;
    }
    _dirty = false;
}

/// Reset all state (for testing or hot-reload).
pub fn reset() void {
    for (0..slot_count) |i| {
        releaseValue(&slots[i].value);
    }
    slot_count = 0;
    array_slot_count = 0;
    str_array_slot_count = 0;
    _dirty = false;
    layout.markLayoutDirty();
}

/// Get current slot count (for debugging).
pub fn slotCount() usize {
    return slot_count;
}

// ── Convenience: increment/decrement for counters ────────────────────────

pub fn incrementSlot(id: usize) void {
    setSlot(id, getSlot(id) + 1);
}

pub fn decrementSlot(id: usize) void {
    setSlot(id, getSlot(id) - 1);
}

pub fn toggleSlot(id: usize) void {
    setSlotBool(id, !getSlotBool(id));
}

// ── Format helper for dynamic text ───────────────────────────────────────

pub fn fmtInt(buf: []u8, val: i64) []const u8 {
    return std.fmt.bufPrint(buf, "{d}", .{val}) catch "?";
}

// ── Array state functions ────────────────────────────────────────────────

/// Create a new array state slot with initial values.
pub fn createArraySlot(initial: []const i64) usize {
    const id = array_slot_count;
    std.debug.assert(id < MAX_ARRAY_SLOTS);
    array_slots[id] = .{
        .values = &[_]i64{},
        .capacity = 0,
        .count = 0,
        .dirty = false,
    };
    array_slots[id].ensureCapacity(@max(initial.len, ARRAY_INITIAL_CAP));
    @memcpy(array_slots[id].values[0..initial.len], initial);
    array_slots[id].count = initial.len;
    array_slot_count += 1;
    return id;
}

/// Get current array values as a slice.
pub fn getArraySlot(id: usize) []const i64 {
    return array_slots[id].values[0..array_slots[id].count];
}

/// Replace entire array contents.
pub fn setArraySlot(id: usize, values: []const i64) void {
    log.info(.state, "arr[{d}] set count={d}", .{ id, values.len });
    array_slots[id].ensureCapacity(values.len);
    const new_count = values.len;
    @memcpy(array_slots[id].values[0..new_count], values[0..new_count]);
    array_slots[id].count = new_count;
    array_slots[id].dirty = true;
    _dirty = true;
    layout.markLayoutDirty();
}

/// Append a value to an array slot.
pub fn pushArraySlot(id: usize, value: i64) void {
    log.info(.state, "arr[{d}] push {d} (count={d})", .{ id, value, array_slots[id].count + 1 });
    const new_count = array_slots[id].count + 1;
    array_slots[id].ensureCapacity(new_count);
    array_slots[id].values[array_slots[id].count] = value;
    array_slots[id].count = new_count;
    array_slots[id].dirty = true;
    _dirty = true;
    layout.markLayoutDirty();
}

/// Remove the last element from an array slot. Returns the removed value (0 if empty).
pub fn popArraySlot(id: usize) i64 {
    if (array_slots[id].count > 0) {
        array_slots[id].count -= 1;
        const val = array_slots[id].values[array_slots[id].count];
        log.info(.state, "arr[{d}] pop {d} (count={d})", .{ id, val, array_slots[id].count });
        array_slots[id].dirty = true;
        _dirty = true;
        layout.markLayoutDirty();
        return val;
    }
    return 0;
}

/// Get the current length of an array slot.
pub fn getArrayLen(id: usize) usize {
    return array_slots[id].count;
}

/// Get a single element from an array slot by index.
pub fn getArrayElement(id: usize, index: usize) i64 {
    if (index >= array_slots[id].count) return 0;
    return array_slots[id].values[index];
}

/// Set a single element in an array slot by index.
pub fn setArrayElement(id: usize, index: usize, value: i64) void {
    if (index >= array_slots[id].count) return;
    log.info(.state, "arr[{d}][{d}] = {d}", .{ id, index, value });
    array_slots[id].values[index] = value;
    array_slots[id].dirty = true;
    _dirty = true;
    layout.markLayoutDirty();
}

// ── State persistence for dev mode hot reload ────────────────────────────

const STATE_FILE = "/tmp/tsz-state.bin";
const STATE_MAGIC = "TSZ2";

pub fn saveState() void {
    const file = std.fs.createFileAbsolute(STATE_FILE, .{}) catch return;
    defer file.close();

    file.writeAll(STATE_MAGIC) catch return;
    const count_bytes: [8]u8 = @bitCast(@as(u64, slot_count));
    file.writeAll(&count_bytes) catch return;

    for (0..slot_count) |i| {
        switch (slots[i].value) {
            .int => |v| {
                file.writeAll(&[_]u8{0}) catch return;
                const val_bytes: [8]u8 = @bitCast(v);
                file.writeAll(&val_bytes) catch return;
            },
            .float => |v| {
                file.writeAll(&[_]u8{1}) catch return;
                const val_bytes: [8]u8 = @bitCast(v);
                file.writeAll(&val_bytes) catch return;
            },
            .boolean => |v| {
                file.writeAll(&[_]u8{2}) catch return;
                file.writeAll(&[_]u8{if (v) 1 else 0}) catch return;
            },
            .string => |s| {
                file.writeAll(&[_]u8{3}) catch return;
                const len_bytes: [4]u8 = @bitCast(@as(u32, @intCast(s.buf.len)));
                file.writeAll(&len_bytes) catch return;
                file.writeAll(s.buf) catch return;
            },
        }
    }
}

pub fn loadState() bool {
    const file = std.fs.openFileAbsolute(STATE_FILE, .{}) catch return false;
    defer file.close();
    defer std.fs.deleteFileAbsolute(STATE_FILE) catch {};

    var magic: [STATE_MAGIC.len]u8 = undefined;
    _ = file.readAll(&magic) catch return false;
    if (!std.mem.eql(u8, &magic, STATE_MAGIC)) return false;

    var count_bytes: [8]u8 = undefined;
    _ = file.readAll(&count_bytes) catch return false;
    const saved_count: u64 = @bitCast(count_bytes);

    const restore_count = @min(saved_count, slot_count);
    for (0..restore_count) |i| {
        var tag_byte: [1]u8 = undefined;
        _ = file.readAll(&tag_byte) catch break;

        releaseValue(&slots[i].value);
        switch (tag_byte[0]) {
            0 => {
                var val_bytes: [8]u8 = undefined;
                _ = file.readAll(&val_bytes) catch break;
                const val: i64 = @bitCast(val_bytes);
                slots[i].value = .{ .int = val };
            },
            1 => {
                var val_bytes: [8]u8 = undefined;
                _ = file.readAll(&val_bytes) catch break;
                const val: f64 = @bitCast(val_bytes);
                slots[i].value = .{ .float = val };
            },
            2 => {
                var bool_byte: [1]u8 = undefined;
                _ = file.readAll(&bool_byte) catch break;
                slots[i].value = .{ .boolean = bool_byte[0] != 0 };
            },
            3 => {
                var len_bytes: [4]u8 = undefined;
                _ = file.readAll(&len_bytes) catch break;
                const slen: usize = @intCast(@as(u32, @bitCast(len_bytes)));
                const buf = alloc.alloc(u8, slen) catch break;
                _ = file.readAll(buf) catch {
                    alloc.free(buf);
                    break;
                };
                slots[i].value = .{ .string = .{ .buf = buf } };
            },
            else => break,
        }
    }

    if (restore_count > 0) {
        _dirty = true;
        layout.markLayoutDirty();
        log.print("[state] Restored {d} slots from previous session\n", .{restore_count});
    }
    return restore_count > 0;
}

// ── Signal handler for dev mode state save ──────────────────────────────

const builtin = @import("builtin");
var _sigusr1_installed = false;

pub fn installSignalHandler() void {
    if (comptime builtin.os.tag == .windows) return;
    if (_sigusr1_installed) return;
    const handler = std.posix.Sigaction{
        .handler = .{ .handler = sigusr1Handler },
        .mask = std.posix.sigemptyset(),
        .flags = 0,
    };
    std.posix.sigaction(std.posix.SIG.USR1, &handler, null);
    _sigusr1_installed = true;
}

fn sigusr1Handler(_: c_int) callconv(.c) void {
    saveState();
}

// ── String array state functions ─────────────────────────────────────────

/// Create a new string array state slot (initially empty).
pub fn createStringArraySlot() usize {
    const id = str_array_slot_count;
    std.debug.assert(id < MAX_STR_ARRAY_SLOTS);
    str_array_slots[id] = .{
        .bufs = &[_][STR_ELEM_BUF_SIZE]u8{},
        .lens = &[_]u16{},
        .capacity = 0,
        .count = 0,
        .dirty = false,
    };
    str_array_slot_count += 1;
    return id;
}

/// Get the number of elements in a string array slot.
pub fn getStringArrayLen(id: usize) usize {
    return str_array_slots[id].count;
}

/// Get a single string element from a string array slot.
pub fn getStringArrayElement(id: usize, index: usize) []const u8 {
    if (index >= str_array_slots[id].count) return "";
    const len = str_array_slots[id].lens[index];
    return str_array_slots[id].bufs[index][0..len];
}

/// Set the entire string array contents from slices.
pub fn setStringArraySlot(id: usize, count: usize, ptrs: []const [*]const u8, lens: []const u16) void {
    str_array_slots[id].ensureCapacity(count);
    for (0..count) |i| {
        const slen = @min(lens[i], STR_ELEM_BUF_SIZE);
        @memcpy(str_array_slots[id].bufs[i][0..slen], ptrs[i][0..slen]);
        str_array_slots[id].lens[i] = slen;
    }
    str_array_slots[id].count = count;
    str_array_slots[id].dirty = true;
    _dirty = true;
    layout.markLayoutDirty();
}

/// Set a single element in a string array (for incremental updates).
pub fn setStringArrayElement(id: usize, index: usize, val: []const u8) void {
    // Grow if needed
    str_array_slots[id].ensureCapacity(index + 1);
    const slen: u16 = @intCast(@min(val.len, STR_ELEM_BUF_SIZE));
    @memcpy(str_array_slots[id].bufs[index][0..slen], val[0..slen]);
    str_array_slots[id].lens[index] = slen;
    if (index >= str_array_slots[id].count) {
        str_array_slots[id].count = index + 1;
    }
    str_array_slots[id].dirty = true;
    _dirty = true;
    layout.markLayoutDirty();
}

/// Resize the string array (set count, zeroing new elements if grown).
pub fn resizeStringArray(id: usize, new_count: usize) void {
    str_array_slots[id].ensureCapacity(new_count);
    if (new_count > str_array_slots[id].count) {
        for (str_array_slots[id].count..new_count) |i| {
            str_array_slots[id].lens[i] = 0;
        }
    }
    str_array_slots[id].count = new_count;
    str_array_slots[id].dirty = true;
    _dirty = true;
    layout.markLayoutDirty();
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub fn telemetryArraySlotCount() usize {
    return array_slot_count;
}

pub fn telemetryStringArraySlotCount() usize {
    return str_array_slot_count;
}

test "string state preserves long values" {
    const testing = std.testing;

    reset();
    defer reset();

    var expected: [900]u8 = undefined;
    for (&expected, 0..) |*ch, i| {
        ch.* = 'a' + @as(u8, @intCast(i % 26));
    }

    const id = createSlotString("");
    setSlotString(id, expected[0..]);

    const actual = getSlotString(id);
    try testing.expectEqual(expected.len, actual.len);
    try testing.expect(std.mem.eql(u8, expected[0..], actual));
}
