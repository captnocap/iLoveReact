//! Line buffer for streaming NDJSON reads from claude stdout.
//!
//! Accumulates partial reads into complete newline-delimited lines.
//! Drains one line at a time via drain(), returning null when no complete
//! line is available. Data after the last newline stays buffered.
//!
//! Ported from codeberg/duhnist/claude-code-sdk-zig. Zig 0.15.2 unmanaged
//! ArrayList pattern; no arena allocator (not needed — line slice borrows
//! from internal buffer until next append()).

const std = @import("std");

pub const ReadBuffer = struct {
    buffer: std.ArrayList(u8) = .{},
    // Stable storage for the most recently drained line. Reused across
    // drain() calls; owned by ReadBuffer and freed in deinit().
    last_line: std.ArrayList(u8) = .{},
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) ReadBuffer {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *ReadBuffer) void {
        self.buffer.deinit(self.allocator);
    }

    pub fn append(self: *ReadBuffer, data: []const u8) !void {
        try self.buffer.appendSlice(self.allocator, data);
    }

    /// Return the next complete line (without the trailing '\n'), or null if
    /// no newline is present. Returned slice is valid until the next mutating
    /// call — copy if you need to retain it.
    pub fn drain(self: *ReadBuffer) ?[]const u8 {
        const items = self.buffer.items;
        const nl = std.mem.indexOfScalar(u8, items, '\n') orelse return null;

        // Skip empty lines transparently — keep draining until a real line
        // or no newline remains.
        if (nl == 0) {
            self.consume(1);
            return self.drain();
        }

        // Copy line into a stable slot so the caller can hold it across
        // further appends to the buffer.
        self.last_line.clearRetainingCapacity();
        self.last_line.appendSlice(self.allocator, items[0..nl]) catch return null;
        self.consume(nl + 1);
        return self.last_line.items;
    }

    /// Drop the first `n` bytes from the front of the buffer.
    fn consume(self: *ReadBuffer, n: usize) void {
        const items = self.buffer.items;
        if (n >= items.len) {
            self.buffer.clearRetainingCapacity();
            return;
        }
        std.mem.copyForwards(u8, items[0 .. items.len - n], items[n..]);
        self.buffer.shrinkRetainingCapacity(items.len - n);
    }
};

test "drain empty" {
    var b = ReadBuffer.init(std.testing.allocator);
    defer b.deinit();
    try std.testing.expect(b.drain() == null);
}

test "drain partial" {
    var b = ReadBuffer.init(std.testing.allocator);
    defer b.deinit();
    try b.append("hello");
    try std.testing.expect(b.drain() == null);
    try b.append(" world\n");
    const line = b.drain() orelse return error.NoLine;
    try std.testing.expectEqualStrings("hello world", line);
    try std.testing.expect(b.drain() == null);
}

test "drain multiple" {
    var b = ReadBuffer.init(std.testing.allocator);
    defer b.deinit();
    try b.append("one\ntwo\nthree\n");
    try std.testing.expectEqualStrings("one", b.drain().?);
    try std.testing.expectEqualStrings("two", b.drain().?);
    try std.testing.expectEqualStrings("three", b.drain().?);
    try std.testing.expect(b.drain() == null);
}

test "drain skips empty lines" {
    var b = ReadBuffer.init(std.testing.allocator);
    defer b.deinit();
    try b.append("\n\nhi\n\n");
    try std.testing.expectEqualStrings("hi", b.drain().?);
    try std.testing.expect(b.drain() == null);
}
