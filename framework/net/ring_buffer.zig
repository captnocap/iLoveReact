//! Thread-safe ring buffer for worker↔main communication.
//!
//! Replaces Love2D's love.thread.getChannel(). Fixed-size queue protected
//! by a mutex. Main thread drains it each frame (poll pattern).
//!
//! Zero heap allocation. Fixed slot array. Lock-free would be nicer but
//! mutex is correct and simple — contention is negligible at 60fps.

const std = @import("std");
const host_io = @import("../host_io.zig");

pub fn RingBuffer(comptime T: type, comptime N: usize) type {
    return struct {
        const Self = @This();

        items: [N]T = undefined,
        head: usize = 0,
        tail: usize = 0,
        count: usize = 0,
        mutex: host_io.Mutex = .{},

        /// Push an item. Returns false if full (caller should retry or drop).
        pub fn push(self: *Self, item: T) bool {
            self.mutex.lock();
            defer self.mutex.unlock();
            if (self.count >= N) return false;
            self.items[self.tail] = item;
            self.tail = (self.tail + 1) % N;
            self.count += 1;
            return true;
        }

        /// Pop one item. Returns null if empty.
        pub fn pop(self: *Self) ?T {
            self.mutex.lock();
            defer self.mutex.unlock();
            if (self.count == 0) return null;
            const item = self.items[self.head];
            self.head = (self.head + 1) % N;
            self.count -= 1;
            return item;
        }

        /// Drain all available items into `out`. Returns count drained.
        /// Non-blocking — returns 0 if empty.
        pub fn drain(self: *Self, out: []T) usize {
            self.mutex.lock();
            defer self.mutex.unlock();
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
        pub fn len(self: *Self) usize {
            self.mutex.lock();
            defer self.mutex.unlock();
            return self.count;
        }

        /// Check if the buffer is empty.
        pub fn isEmpty(self: *Self) bool {
            return self.len() == 0;
        }
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

test "push and pop" {
    var buf = RingBuffer(u32, 4){};
    try std.testing.expect(buf.push(10));
    try std.testing.expect(buf.push(20));
    try std.testing.expect(buf.push(30));
    try std.testing.expectEqual(@as(?u32, 10), buf.pop());
    try std.testing.expectEqual(@as(?u32, 20), buf.pop());
    try std.testing.expectEqual(@as(?u32, 30), buf.pop());
    try std.testing.expectEqual(@as(?u32, null), buf.pop());
}

test "full buffer rejects push" {
    var buf = RingBuffer(u32, 2){};
    try std.testing.expect(buf.push(1));
    try std.testing.expect(buf.push(2));
    try std.testing.expect(!buf.push(3)); // full
    _ = buf.pop();
    try std.testing.expect(buf.push(3)); // now has room
}

test "drain" {
    var buf = RingBuffer(u32, 8){};
    _ = buf.push(100);
    _ = buf.push(200);
    _ = buf.push(300);
    var out: [8]u32 = undefined;
    const n = buf.drain(&out);
    try std.testing.expectEqual(@as(usize, 3), n);
    try std.testing.expectEqual(@as(u32, 100), out[0]);
    try std.testing.expectEqual(@as(u32, 200), out[1]);
    try std.testing.expectEqual(@as(u32, 300), out[2]);
    try std.testing.expect(buf.isEmpty());
}

test "wraparound" {
    var buf = RingBuffer(u32, 4){};
    _ = buf.push(1);
    _ = buf.push(2);
    _ = buf.push(3);
    _ = buf.push(4);
    _ = buf.pop(); // head moves
    _ = buf.pop();
    _ = buf.push(5); // wraps around
    _ = buf.push(6);
    try std.testing.expectEqual(@as(?u32, 3), buf.pop());
    try std.testing.expectEqual(@as(?u32, 4), buf.pop());
    try std.testing.expectEqual(@as(?u32, 5), buf.pop());
    try std.testing.expectEqual(@as(?u32, 6), buf.pop());
}

test "drain with small output buffer" {
    var buf = RingBuffer(u32, 8){};
    _ = buf.push(1);
    _ = buf.push(2);
    _ = buf.push(3);
    _ = buf.push(4);
    _ = buf.push(5);
    var out: [2]u32 = undefined;
    const n1 = buf.drain(&out);
    try std.testing.expectEqual(@as(usize, 2), n1);
    try std.testing.expectEqual(@as(u32, 1), out[0]);
    try std.testing.expectEqual(@as(u32, 2), out[1]);
    try std.testing.expectEqual(@as(usize, 3), buf.len());
    const n2 = buf.drain(&out);
    try std.testing.expectEqual(@as(usize, 2), n2);
    try std.testing.expectEqual(@as(u32, 3), out[0]);
    try std.testing.expectEqual(@as(u32, 4), out[1]);
    const n3 = buf.drain(&out);
    try std.testing.expectEqual(@as(usize, 1), n3);
    try std.testing.expectEqual(@as(u32, 5), out[0]);
    try std.testing.expect(buf.isEmpty());
}

test "struct payload" {
    const Msg = struct { id: u32, val: f32 };
    var buf = RingBuffer(Msg, 4){};
    try std.testing.expect(buf.push(.{ .id = 1, .val = 3.14 }));
    try std.testing.expect(buf.push(.{ .id = 2, .val = 2.72 }));
    const m1 = buf.pop().?;
    try std.testing.expectEqual(@as(u32, 1), m1.id);
    const m2 = buf.pop().?;
    try std.testing.expectEqual(@as(u32, 2), m2.id);
    try std.testing.expect(buf.isEmpty());
}

test "len and isEmpty" {
    var buf = RingBuffer(u8, 4){};
    try std.testing.expect(buf.isEmpty());
    try std.testing.expectEqual(@as(usize, 0), buf.len());
    _ = buf.push(1);
    try std.testing.expect(!buf.isEmpty());
    try std.testing.expectEqual(@as(usize, 1), buf.len());
    _ = buf.push(2);
    _ = buf.push(3);
    _ = buf.push(4);
    try std.testing.expectEqual(@as(usize, 4), buf.len());
    _ = buf.pop();
    try std.testing.expectEqual(@as(usize, 3), buf.len());
}

test "drain empty buffer" {
    var buf = RingBuffer(u32, 4){};
    var out: [4]u32 = undefined;
    try std.testing.expectEqual(@as(usize, 0), buf.drain(&out));
}

test "threaded push/pop" {
    const RB = RingBuffer(u32, 256);
    var buf = RB{};
    const count = 1000;

    const producer = struct {
        fn run(b: *RB) void {
            var i: u32 = 0;
            while (i < count) {
                if (b.push(i)) {
                    i += 1;
                }
            }
        }
    }.run;

    const t = try std.Thread.spawn(.{}, producer, .{&buf});

    var received: u32 = 0;
    while (received < count) {
        if (buf.pop()) |_| {
            received += 1;
        }
    }

    t.join();
    try std.testing.expectEqual(@as(u32, count), received);
    try std.testing.expect(buf.isEmpty());
}
