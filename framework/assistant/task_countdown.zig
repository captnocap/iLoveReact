//! Completion accounting for a bounded `std.Io.Group` task set.

const std = @import("std");

pub const TaskCountdown = struct {
    remaining: std.atomic.Value(usize),

    pub fn init(task_count: usize) TaskCountdown {
        return .{ .remaining = .init(task_count) };
    }

    /// Returns true exactly once: to the task that completes the set.
    pub fn complete(self: *TaskCountdown) bool {
        const before = self.remaining.fetchSub(1, .seq_cst);
        std.debug.assert(before > 0);
        return before == 1;
    }

    pub fn pending(self: *const TaskCountdown) usize {
        return self.remaining.load(.seq_cst);
    }
};

fn completeTask(
    countdown: *TaskCountdown,
    completed: *std.atomic.Value(usize),
    last_count: *std.atomic.Value(usize),
) std.Io.Cancelable!void {
    _ = completed.fetchAdd(1, .seq_cst);
    if (countdown.complete()) _ = last_count.fetchAdd(1, .seq_cst);
}

fn cancellableTask(
    io: std.Io,
    countdown: *TaskCountdown,
    last_count: *std.atomic.Value(usize),
) std.Io.Cancelable!void {
    defer {
        if (countdown.complete()) _ = last_count.fetchAdd(1, .seq_cst);
    }
    while (true) try std.Io.sleep(io, .fromSeconds(1), .awake);
}

test "Io Group tasks identify exactly one final completion" {
    const task_count = 8;
    var countdown = TaskCountdown.init(task_count);
    var completed = std.atomic.Value(usize).init(0);
    var last_count = std.atomic.Value(usize).init(0);
    var tasks: std.Io.Group = .init;

    for (0..task_count) |_| {
        try tasks.concurrent(std.testing.io, completeTask, .{ &countdown, &completed, &last_count });
    }
    try tasks.await(std.testing.io);

    try std.testing.expectEqual(task_count, completed.load(.seq_cst));
    try std.testing.expectEqual(@as(usize, 0), countdown.pending());
    try std.testing.expectEqual(@as(usize, 1), last_count.load(.seq_cst));
}

test "zero-task countdown starts empty" {
    var countdown = TaskCountdown.init(0);
    try std.testing.expectEqual(@as(usize, 0), countdown.pending());
}

test "Io Group cancellation still completes every task defer" {
    const task_count = 4;
    var countdown = TaskCountdown.init(task_count);
    var last_count = std.atomic.Value(usize).init(0);
    var tasks: std.Io.Group = .init;

    for (0..task_count) |_| {
        try tasks.concurrent(std.testing.io, cancellableTask, .{ std.testing.io, &countdown, &last_count });
    }
    tasks.cancel(std.testing.io);

    try std.testing.expectEqual(@as(usize, 0), countdown.pending());
    try std.testing.expectEqual(@as(usize, 1), last_count.load(.seq_cst));
}
