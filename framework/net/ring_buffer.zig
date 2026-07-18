//! Thread-safe ring buffer for worker↔main communication.
//!
//! Replaces Love2D's love.thread.getChannel(). Fixed-size queue protected
//! by a mutex. Main thread drains it each frame (poll pattern).
//!
//! Zero heap allocation. Fixed slot array. Lock-free would be nicer but
//! mutex is correct and simple — contention is negligible at 60fps.

const std = @import("std");

pub fn RingBuffer(comptime T: type, comptime N: usize) type {
    return struct {
        const Self = @This();

        items: [N]T = undefined,
        head: usize = 0,
        tail: usize = 0,
        count: usize = 0,
        mutex: std.Io.Mutex = .init,

        /// Push an item. Returns false if full (caller should retry or drop).
        pub fn push(self: *Self, io: std.Io, item: T) bool {
            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);
            if (self.count >= N) return false;
            self.items[self.tail] = item;
            self.tail = (self.tail + 1) % N;
            self.count += 1;
            return true;
        }

        /// Pop one item. Returns null if empty.
        pub fn pop(self: *Self, io: std.Io) ?T {
            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);
            if (self.count == 0) return null;
            const item = self.items[self.head];
            self.head = (self.head + 1) % N;
            self.count -= 1;
            return item;
        }

        /// Drain all available items into `out`. Returns count drained.
        /// Non-blocking — returns 0 if empty.
        pub fn drain(self: *Self, io: std.Io, out: []T) usize {
            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);
            var i: usize = 0;
            while (i < out.len and self.count > 0) {
                out[i] = self.items[self.head];
                self.head = (self.head + 1) % N;
                self.count -= 1;
                i += 1;
            }
            return i;
        }

        /// Check how many items are queued.
        pub fn len(self: *Self, io: std.Io) usize {
            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);
            return self.count;
        }

        /// Check if the buffer is empty.
        pub fn isEmpty(self: *Self, io: std.Io) bool {
            return self.len(io) == 0;
        }
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

test "push and pop" {
    var buf = RingBuffer(u32, 4){};
    try std.testing.expect(buf.push(std.testing.io, 10));
    try std.testing.expect(buf.push(std.testing.io, 20));
    try std.testing.expect(buf.push(std.testing.io, 30));
    try std.testing.expectEqual(@as(?u32, 10), buf.pop(std.testing.io));
    try std.testing.expectEqual(@as(?u32, 20), buf.pop(std.testing.io));
    try std.testing.expectEqual(@as(?u32, 30), buf.pop(std.testing.io));
    try std.testing.expectEqual(@as(?u32, null), buf.pop(std.testing.io));
}

test "full buffer rejects push" {
    var buf = RingBuffer(u32, 2){};
    try std.testing.expect(buf.push(std.testing.io, 1));
    try std.testing.expect(buf.push(std.testing.io, 2));
    try std.testing.expect(!buf.push(std.testing.io, 3)); // full
    _ = buf.pop(std.testing.io);
    try std.testing.expect(buf.push(std.testing.io, 3)); // now has room
}

test "drain" {
    var buf = RingBuffer(u32, 8){};
    _ = buf.push(std.testing.io, 100);
    _ = buf.push(std.testing.io, 200);
    _ = buf.push(std.testing.io, 300);
    var out: [8]u32 = undefined;
    const n = buf.drain(std.testing.io, &out);
    try std.testing.expectEqual(@as(usize, 3), n);
    try std.testing.expectEqual(@as(u32, 100), out[0]);
    try std.testing.expectEqual(@as(u32, 200), out[1]);
    try std.testing.expectEqual(@as(u32, 300), out[2]);
    try std.testing.expect(buf.isEmpty(std.testing.io));
}

test "wraparound" {
    var buf = RingBuffer(u32, 4){};
    _ = buf.push(std.testing.io, 1);
    _ = buf.push(std.testing.io, 2);
    _ = buf.push(std.testing.io, 3);
    _ = buf.push(std.testing.io, 4);
    _ = buf.pop(std.testing.io); // head moves
    _ = buf.pop(std.testing.io);
    _ = buf.push(std.testing.io, 5); // wraps around
    _ = buf.push(std.testing.io, 6);
    try std.testing.expectEqual(@as(?u32, 3), buf.pop(std.testing.io));
    try std.testing.expectEqual(@as(?u32, 4), buf.pop(std.testing.io));
    try std.testing.expectEqual(@as(?u32, 5), buf.pop(std.testing.io));
    try std.testing.expectEqual(@as(?u32, 6), buf.pop(std.testing.io));
}

test "drain with small output buffer" {
    var buf = RingBuffer(u32, 8){};
    _ = buf.push(std.testing.io, 1);
    _ = buf.push(std.testing.io, 2);
    _ = buf.push(std.testing.io, 3);
    _ = buf.push(std.testing.io, 4);
    _ = buf.push(std.testing.io, 5);
    var out: [2]u32 = undefined;
    const n1 = buf.drain(std.testing.io, &out);
    try std.testing.expectEqual(@as(usize, 2), n1);
    try std.testing.expectEqual(@as(u32, 1), out[0]);
    try std.testing.expectEqual(@as(u32, 2), out[1]);
    try std.testing.expectEqual(@as(usize, 3), buf.len(std.testing.io));
    const n2 = buf.drain(std.testing.io, &out);
    try std.testing.expectEqual(@as(usize, 2), n2);
    try std.testing.expectEqual(@as(u32, 3), out[0]);
    try std.testing.expectEqual(@as(u32, 4), out[1]);
    const n3 = buf.drain(std.testing.io, &out);
    try std.testing.expectEqual(@as(usize, 1), n3);
    try std.testing.expectEqual(@as(u32, 5), out[0]);
    try std.testing.expect(buf.isEmpty(std.testing.io));
}

test "struct payload" {
    const Msg = struct { id: u32, val: f32 };
    var buf = RingBuffer(Msg, 4){};
    try std.testing.expect(buf.push(std.testing.io, .{ .id = 1, .val = 3.14 }));
    try std.testing.expect(buf.push(std.testing.io, .{ .id = 2, .val = 2.72 }));
    const m1 = buf.pop(std.testing.io).?;
    try std.testing.expectEqual(@as(u32, 1), m1.id);
    const m2 = buf.pop(std.testing.io).?;
    try std.testing.expectEqual(@as(u32, 2), m2.id);
    try std.testing.expect(buf.isEmpty(std.testing.io));
}

test "len and isEmpty" {
    var buf = RingBuffer(u8, 4){};
    try std.testing.expect(buf.isEmpty(std.testing.io));
    try std.testing.expectEqual(@as(usize, 0), buf.len(std.testing.io));
    _ = buf.push(std.testing.io, 1);
    try std.testing.expect(!buf.isEmpty(std.testing.io));
    try std.testing.expectEqual(@as(usize, 1), buf.len(std.testing.io));
    _ = buf.push(std.testing.io, 2);
    _ = buf.push(std.testing.io, 3);
    _ = buf.push(std.testing.io, 4);
    try std.testing.expectEqual(@as(usize, 4), buf.len(std.testing.io));
    _ = buf.pop(std.testing.io);
    try std.testing.expectEqual(@as(usize, 3), buf.len(std.testing.io));
}

test "drain empty buffer" {
    var buf = RingBuffer(u32, 4){};
    var out: [4]u32 = undefined;
    try std.testing.expectEqual(@as(usize, 0), buf.drain(std.testing.io, &out));
}

test "concurrent push/pop through injected io" {
    const RB = RingBuffer(u32, 256);
    var buf = RB{};
    const count = 1000;

    const producer = struct {
        fn run(io: std.Io, b: *RB) std.Io.Cancelable!void {
            var i: u32 = 0;
            while (i < count) {
                if (b.push(io, i)) {
                    i += 1;
                }
            }
        }
    }.run;

    var tasks: std.Io.Group = .init;
    try tasks.concurrent(std.testing.io, producer, .{ std.testing.io, &buf });

    var received: u32 = 0;
    while (received < count) {
        if (buf.pop(std.testing.io)) |_| {
            received += 1;
        }
    }

    try tasks.await(std.testing.io);
    try std.testing.expectEqual(@as(u32, count), received);
    try std.testing.expect(buf.isEmpty(std.testing.io));
}
