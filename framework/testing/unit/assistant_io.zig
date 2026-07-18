//! Native I/O ownership tests for assistant background work.
//!
//! These pin the two lifecycle properties that raw `std.Thread` ownership did
//! not provide: queued work remains valid when ArrayList storage relocates,
//! and cancellation reaches the task's injected `std.Io` cancellation point
//! before the executor releases task-owned memory.

const std = @import("std");
const testing = std.testing;
const api = @import("../../assistant/tool_framework.zig");
const local_ai_runtime = @import("../../assistant/local_ai_runtime.zig");
const local_ai_runtime_old = @import("../../assistant/local_ai_runtime_old.zig");

const Tool = api.Tool;
const ToolContext = api.ToolContext;
const ToolExecutor = api.ToolExecutor;
const ToolResult = api.ToolResult;

test "local inference runtimes own injected Io task groups" {
    try testing.expect(std.meta.fieldInfo(local_ai_runtime.Session, .tasks).type == std.Io.Group);
    try testing.expect(std.meta.fieldInfo(local_ai_runtime_old.Session, .tasks).type == std.Io.Group);
}

test "tool executor owns concurrent work with an Io group" {
    const TestTool = struct {
        fn execute(_: []const u8, context: *const ToolContext) !ToolResult {
            return .{ .content = try context.allocator.dupe(u8, "ok") };
        }

        fn concurrencySafe(_: []const u8) bool {
            return true;
        }

        fn readOnly(_: []const u8) bool {
            return true;
        }
    };

    const tool: Tool = .{
        .name = "test",
        .description = "test",
        .input_schema = .{},
        .execute = TestTool.execute,
        .isConcurrencySafeFn = TestTool.concurrencySafe,
        .isReadOnlyFn = TestTool.readOnly,
    };

    var executor = ToolExecutor.init(testing.io, testing.allocator);
    defer executor.deinit();

    // Enough entries to force ArrayList relocation while tasks are live.
    // Tasks retain indexes and owned slices, never element pointers.
    for (0..64) |index| {
        var id_buffer: [32]u8 = undefined;
        const id = try std.fmt.bufPrint(&id_buffer, "tool-{d}", .{index});
        try executor.queue(tool, id, "{}", null);
    }
    executor.waitAll();

    for (0..64) |index| {
        var id_buffer: [32]u8 = undefined;
        const id = try std.fmt.bufPrint(&id_buffer, "tool-{d}", .{index});
        var result = executor.getResult(id) orelse return error.MissingToolResult;
        defer result.deinit(testing.allocator);
        try testing.expectEqualStrings("ok", result.content);
        try testing.expect(!result.is_error);
    }
}

test "tool executor cancellation reaches native Io cancellation points" {
    const CancelTool = struct {
        var started: std.atomic.Value(bool) = .init(false);
        var canceled: std.atomic.Value(bool) = .init(false);

        fn execute(_: []const u8, context: *const ToolContext) !ToolResult {
            started.store(true, .seq_cst);
            std.Io.sleep(context.io, .fromSeconds(30), .awake) catch |err| {
                if (err == error.Canceled) canceled.store(true, .seq_cst);
                return err;
            };
            return .{ .content = try context.allocator.dupe(u8, "unexpected") };
        }

        fn concurrencySafe(_: []const u8) bool {
            return true;
        }

        fn readOnly(_: []const u8) bool {
            return true;
        }
    };

    CancelTool.started.store(false, .seq_cst);
    CancelTool.canceled.store(false, .seq_cst);

    const tool: Tool = .{
        .name = "cancel-test",
        .description = "cancel-test",
        .input_schema = .{},
        .execute = CancelTool.execute,
        .isConcurrencySafeFn = CancelTool.concurrencySafe,
        .isReadOnlyFn = CancelTool.readOnly,
    };

    var executor = ToolExecutor.init(testing.io, testing.allocator);
    defer executor.deinit();
    try executor.queue(tool, "cancel-1", "{}", null);
    while (!CancelTool.started.load(.seq_cst)) {
        try std.Io.sleep(testing.io, .fromMilliseconds(1), .awake);
    }

    executor.cancelAll();
    try testing.expect(CancelTool.canceled.load(.seq_cst));
    try testing.expectEqual(.yielded, executor.pending_tools.items[0].status);
}
