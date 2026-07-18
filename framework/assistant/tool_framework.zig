//! Tool Framework — Model-agnostic tool execution with concurrency control
//!
//! Ports the key concepts from Claude CLI's tool system:
//!   - Tools are registered by name
//!   - isConcurrencySafe determines parallel vs exclusive execution
//!   - Streaming results with progress callbacks
//!   - Sibling abort: bash errors cancel other bash tools
//!
//! Usage from .tsz:
//!   import { Tool, registerTool, executeTool } from '@reactjit/tools';
//!
//!   const myTool: Tool = {
//!     name: "search",
//!     description: "Search for files",
//!     inputSchema: { pattern: "string" },
//!     isConcurrencySafe: () => true,
//!     execute: async (input) => { ... }
//!   };

const std = @import("std");
const log = @import("../diag/log.zig");
const PTY = @import("../terminal/pty.zig");

// ═════════════════════════════════════════════════════════════════════════════
// Tool Definition
// ═════════════════════════════════════════════════════════════════════════════

pub const ToolInputSchema = struct {
    type: []const u8 = "object",
    properties: ?std.json.ObjectMap = null,
    required: ?[][]const u8 = null,
};

pub const ToolResult = struct {
    content: []const u8,
    is_error: bool = false,

    pub fn deinit(self: *ToolResult, allocator: std.mem.Allocator) void {
        allocator.free(self.content);
    }
};

pub const ProgressUpdate = struct {
    pub const Status = enum { pending, running, progress, completed, error_ };

    tool_use_id: []const u8,
    status: Status,
    message: ?[]const u8 = null,
    percent: ?u8 = null,
};

/// Tool execution context - passed to every tool call
pub const ToolContext = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    work_dir: ?[]const u8,
    tool_use_id: []const u8,

    /// Send progress update (streaming to UI)
    on_progress: ?*const fn (ctx: ?*anyopaque, update: ProgressUpdate) void,
    on_progress_ctx: ?*anyopaque,

    /// Check if we should abort (sibling error or user cancel)
    should_abort: *const fn (ctx: ?*anyopaque) bool,
    should_abort_ctx: ?*anyopaque,

    pub fn reportProgress(self: *const ToolContext, status: ProgressUpdate.Status, message: ?[]const u8, percent: ?u8) void {
        if (self.on_progress) |cb| {
            cb(self.on_progress_ctx, .{
                .tool_use_id = self.tool_use_id,
                .status = status,
                .message = message,
                .percent = percent,
            });
        }
    }

    pub fn checkAbort(self: *const ToolContext) bool {
        return self.should_abort(self.should_abort_ctx);
    }
};

/// Tool function signature
pub const ToolExecuteFn = *const fn (
    input_json: []const u8,
    ctx: *const ToolContext,
) anyerror!ToolResult;

/// Tool validation function - check if input is valid before execution
pub const ToolValidateFn = *const fn (input_json: []const u8) anyerror!bool;

/// A tool that can be called by the agent
pub const Tool = struct {
    name: []const u8,
    description: []const u8,
    input_schema: ToolInputSchema,

    /// Execute the tool (called in a concurrent I/O task)
    execute: ToolExecuteFn,

    /// Validate input before execution (optional)
    validate: ?ToolValidateFn = null,

    /// Can this tool run concurrently with other concurrent-safe tools?
    /// - true: Can run in parallel with other concurrent-safe tools
    /// - false: Must execute exclusively (blocks other tools)
    isConcurrencySafeFn: *const fn (input_json: []const u8) bool,

    /// Does this tool read files (for permission tracking)?
    isReadOnlyFn: *const fn (input_json: []const u8) bool,

    /// Is this tool destructive (delete, overwrite)?
    isDestructiveFn: ?*const fn (input_json: []const u8) bool = null,

    /// For bash-like tools: does this command modify shell state (cd, export)?
    modifiesShellStateFn: ?*const fn (input_json: []const u8) bool = null,

    pub fn isConcurrencySafe(self: Tool, input_json: []const u8) bool {
        return self.isConcurrencySafeFn(input_json);
    }

    pub fn isReadOnly(self: Tool, input_json: []const u8) bool {
        return self.isReadOnlyFn(input_json);
    }

    pub fn isDestructive(self: Tool, input_json: []const u8) bool {
        if (self.isDestructiveFn) |f| return f(input_json);
        return false;
    }

    pub fn modifiesShellState(self: Tool, input_json: []const u8) bool {
        if (self.modifiesShellStateFn) |f| return f(input_json);
        return false;
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool Registry
// ═════════════════════════════════════════════════════════════════════════════

pub const ToolRegistry = struct {
    allocator: std.mem.Allocator,
    tools: std.StringHashMap(Tool),

    pub fn init(allocator: std.mem.Allocator) ToolRegistry {
        return .{
            .allocator = allocator,
            .tools = std.StringHashMap(Tool).init(allocator),
        };
    }

    pub fn deinit(self: *ToolRegistry) void {
        self.tools.deinit();
    }

    pub fn register(self: *ToolRegistry, tool: Tool) !void {
        try self.tools.put(tool.name, tool);
    }

    pub fn get(self: *ToolRegistry, name: []const u8) ?Tool {
        return self.tools.get(name);
    }

    pub fn unregister(self: *ToolRegistry, name: []const u8) bool {
        return self.tools.remove(name);
    }

    pub fn list(self: *ToolRegistry) std.StringHashMap(Tool).Iterator {
        return self.tools.iterator();
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool Executor (StreamingToolExecutor port)
// ═════════════════════════════════════════════════════════════════════════════

pub const QueuedTool = struct {
    tool: Tool,
    tool_use_id: []const u8,
    input_json: []const u8,
    work_dir: ?[]u8,
    context: ToolContext,
    status: enum { queued, executing, completed, yielded },
    result: ?ToolResult,
};

pub const ToolExecutor = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    pending_tools: std.ArrayList(QueuedTool),
    tasks: std.Io.Group,
    mutex: std.Io.Mutex,

    /// Abort state
    has_errored: bool = false,
    errored_tool_description: ?[]const u8 = null,
    should_abort: std.atomic.Value(bool) = .init(false),

    /// Callbacks
    on_progress: ?*const fn (ctx: ?*anyopaque, update: ProgressUpdate) void = null,
    on_progress_ctx: ?*anyopaque = null,
    on_complete: ?*const fn (ctx: ?*anyopaque, tool_use_id: []const u8, result: ToolResult) void = null,
    on_complete_ctx: ?*anyopaque = null,

    pub fn init(io: std.Io, allocator: std.mem.Allocator) ToolExecutor {
        return .{
            .io = io,
            .allocator = allocator,
            .pending_tools = .empty,
            .tasks = .init,
            .mutex = .init,
        };
    }

    pub fn deinit(self: *ToolExecutor) void {
        self.should_abort.store(true, .seq_cst);
        self.tasks.cancel(self.io);
        for (self.pending_tools.items) |*item| {
            self.allocator.free(item.tool_use_id);
            self.allocator.free(item.input_json);
            if (item.work_dir) |work_dir| self.allocator.free(work_dir);
            if (item.result) |*r| r.deinit(self.allocator);
        }
        if (self.errored_tool_description) |description| self.allocator.free(description);
        self.pending_tools.deinit(self.allocator);
    }

    /// Queue a tool for execution. Returns immediately.
    pub fn queue(self: *ToolExecutor, tool: Tool, tool_use_id: []const u8, input_json: []const u8, work_dir: ?[]const u8) !void {
        const id_copy = try self.allocator.dupe(u8, tool_use_id);
        errdefer self.allocator.free(id_copy);

        const input_copy = try self.allocator.dupe(u8, input_json);
        errdefer self.allocator.free(input_copy);

        const work_dir_copy = if (work_dir) |path| try self.allocator.dupe(u8, path) else null;
        errdefer if (work_dir_copy) |path| self.allocator.free(path);

        const context = ToolContext{
            .io = self.io,
            .allocator = self.allocator,
            .work_dir = work_dir_copy,
            .tool_use_id = id_copy,
            .on_progress = self.on_progress,
            .on_progress_ctx = self.on_progress_ctx,
            .should_abort = struct {
                fn check(ctx: ?*anyopaque) bool {
                    const exec = @as(*ToolExecutor, @ptrCast(@alignCast(ctx)));
                    return exec.should_abort.load(.seq_cst);
                }
            }.check,
            .should_abort_ctx = self,
        };

        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);

        try self.pending_tools.append(self.allocator, .{
            .tool = tool,
            .tool_use_id = id_copy,
            .input_json = input_copy,
            .work_dir = work_dir_copy,
            .context = context,
            .status = .queued,
            .result = null,
        });

        // Start processing if not already running
        self.processQueue();
    }

    /// Check if we can execute a tool based on concurrency rules
    /// Caller holds `mutex`; queue state must remain stable through the check.
    fn canExecuteLocked(self: *ToolExecutor, tool: Tool, input_json: []const u8) bool {
        const is_safe = tool.isConcurrencySafe(input_json);

        // Count executing tools
        var executing_count: usize = 0;
        var has_exclusive = false;

        for (self.pending_tools.items) |item| {
            if (item.status == .executing) {
                executing_count += 1;
                if (!item.tool.isConcurrencySafe(item.input_json)) {
                    has_exclusive = true;
                }
            }
        }

        if (executing_count == 0) return true;

        // Concurrent-safe tools can run with other concurrent-safe tools
        if (is_safe and !has_exclusive) return true;

        return false;
    }

    /// Process the queue, starting tools when conditions allow
    fn processQueue(self: *ToolExecutor) void {
        if (self.should_abort.load(.seq_cst)) return;

        for (self.pending_tools.items, 0..) |item, item_index| {
            if (item.status != .queued) continue;

            if (self.canExecuteLocked(item.tool, item.input_json)) {
                self.executeTool(item_index);
            } else {
                // Can't execute this tool yet
                // If it's not concurrent-safe, stop here (maintain order)
                if (!item.tool.isConcurrencySafe(item.input_json)) break;
            }
        }
    }

    fn executeTool(self: *ToolExecutor, item_index: usize) void {
        const item = &self.pending_tools.items[item_index];
        item.status = .executing;
        item.context.reportProgress(.running, "Starting...", 0);

        // Report progress callback wrapper
        const progress_wrapper = struct {
            fn onProgress(ctx: ?*anyopaque, update: ProgressUpdate) void {
                const exec = @as(*ToolExecutor, @ptrCast(@alignCast(ctx)));
                if (exec.on_progress) |cb| {
                    cb(exec.on_progress_ctx, update);
                }
            }
        }.onProgress;

        item.context.on_progress = progress_wrapper;
        item.context.on_progress_ctx = self;

        // ArrayList storage can move when another tool is queued. Pass an
        // index to the task and copy the immutable call data while holding
        // the executor mutex instead of retaining an element pointer.
        self.tasks.concurrent(self.io, runTool, .{ self, item_index }) catch |err| {
            log.err(.engine, "Failed to start tool task: {s}", .{@errorName(err)});
            item.status = .completed;
            const content = self.allocator.dupe(u8, "Failed to start tool execution") catch return;
            item.result = .{ .content = content, .is_error = true };
            return;
        };
    }

    /// Wait for all queued tools to complete
    pub fn waitAll(self: *ToolExecutor) void {
        self.tasks.await(self.io) catch {};
    }

    fn runTool(exec: *ToolExecutor, item_index: usize) std.Io.Cancelable!void {
        exec.mutex.lockUncancelable(exec.io);
        const item = &exec.pending_tools.items[item_index];
        const tool = item.tool;
        const input_json = item.input_json;
        const context = item.context;
        exec.mutex.unlock(exec.io);

        const result = tool.execute(input_json, &context) catch |err| result: {
            if (err == error.Canceled) return error.Canceled;
            const err_msg = std.fmt.allocPrint(exec.allocator, "Tool error: {s}", .{@errorName(err)}) catch {
                exec.finishWithoutResult(item_index);
                return;
            };
            break :result ToolResult{
                .content = err_msg,
                .is_error = true,
            };
        };

        exec.mutex.lockUncancelable(exec.io);
        defer exec.mutex.unlock(exec.io);

        const completed_item = &exec.pending_tools.items[item_index];
        completed_item.result = result;
        completed_item.status = .completed;

        // Check for bash errors - trigger sibling abort.
        if (tool.name.len >= 4 and
            std.mem.eql(u8, tool.name[0..4], "bash") and
            result.is_error)
        {
            exec.has_errored = true;
            if (exec.errored_tool_description == null) {
                exec.errored_tool_description = exec.allocator.dupe(u8, tool.name) catch null;
            }
            exec.should_abort.store(true, .seq_cst);
        }

        if (exec.on_complete) |cb| {
            cb(exec.on_complete_ctx, completed_item.tool_use_id, result);
        }

        exec.processQueue();
    }

    fn finishWithoutResult(self: *ToolExecutor, item_index: usize) void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        self.pending_tools.items[item_index].status = .completed;
        self.processQueue();
    }

    /// Get result for a specific tool_use_id
    pub fn getResult(self: *ToolExecutor, tool_use_id: []const u8) ?ToolResult {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);

        for (self.pending_tools.items) |item| {
            if (std.mem.eql(u8, item.tool_use_id, tool_use_id)) {
                if (item.result) |r| {
                    // Return a copy
                    return .{
                        .content = self.allocator.dupe(u8, r.content) catch return null,
                        .is_error = r.is_error,
                    };
                }
            }
        }
        return null;
    }

    /// Cancel all pending and executing tools
    pub fn cancelAll(self: *ToolExecutor) void {
        self.mutex.lockUncancelable(self.io);
        self.should_abort.store(true, .seq_cst);

        // Signal all executing tools to check abort
        for (self.pending_tools.items) |*item| {
            if (item.status == .executing) {
                item.context.reportProgress(.error_, "Cancelled", 0);
            } else if (item.status == .queued) {
                item.status = .yielded;
            }
        }
        self.mutex.unlock(self.io);

        // Cancellation is also delivered to native I/O cancellation points,
        // then all task resources are joined before returning.
        self.tasks.cancel(self.io);

        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        for (self.pending_tools.items) |*item| {
            if (item.status == .executing) item.status = .yielded;
        }
    }

    /// Reset state for new turn
    pub fn reset(self: *ToolExecutor) void {
        self.waitAll();

        for (self.pending_tools.items) |*item| {
            self.allocator.free(item.tool_use_id);
            self.allocator.free(item.input_json);
            if (item.work_dir) |work_dir| self.allocator.free(work_dir);
            if (item.result) |*r| r.deinit(self.allocator);
        }

        self.pending_tools.clearRetainingCapacity();
        self.has_errored = false;
        if (self.errored_tool_description) |description| self.allocator.free(description);
        self.errored_tool_description = null;
        self.should_abort.store(false, .seq_cst);
    }

    pub fn setOnProgress(self: *ToolExecutor, cb: ?*const fn (ctx: ?*anyopaque, update: ProgressUpdate) void, ctx: ?*anyopaque) void {
        self.on_progress = cb;
        self.on_progress_ctx = ctx;
    }

    pub fn setOnComplete(self: *ToolExecutor, cb: ?*const fn (ctx: ?*anyopaque, tool_use_id: []const u8, result: ToolResult) void, ctx: ?*anyopaque) void {
        self.on_complete = cb;
        self.on_complete_ctx = ctx;
    }

    /// Execute a single tool synchronously (for simple cases)
    pub fn execute(self: *ToolExecutor, tool: Tool, input_json: []const u8, work_dir: ?[]const u8) ![]const u8 {
        const context = ToolContext{
            .io = self.io,
            .allocator = self.allocator,
            .work_dir = work_dir,
            .tool_use_id = "sync",
            .on_progress = null,
            .on_progress_ctx = null,
            .should_abort = struct {
                fn check(_: ?*anyopaque) bool {
                    return false;
                }
            }.check,
            .should_abort_ctx = null,
        };

        const result = try tool.execute(input_json, &context);
        defer result.deinit(self.allocator);

        return self.allocator.dupe(u8, result.content);
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Built-in Tools
// ═════════════════════════════════════════════════════════════════════════════

pub const BuiltInTools = struct {
    /// Bash tool - execute shell commands
    pub fn bashTool() Tool {
        return .{
            .name = "bash",
            .description = "Execute bash commands. Use && for chaining, ; for sequential.",
            .input_schema = .{
                .type = "object",
                .properties = null, // TODO: proper JSON schema
            },
            .execute = bashExecute,
            .isConcurrencySafeFn = bashIsConcurrencySafe,
            .isReadOnlyFn = bashIsReadOnly,
            .isDestructiveFn = bashIsDestructive,
            .modifiesShellStateFn = bashModifiesShellState,
        };
    }

    fn bashExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
        // Parse input
        var parsed = try std.json.parseFromSlice(struct {
            command: []const u8,
            timeout_ms: ?u32 = null,
        }, ctx.allocator, input_json, .{});
        defer parsed.deinit();

        const cmd = parsed.value.command;
        const timeout = parsed.value.timeout_ms orelse 30_000; // 30s default

        ctx.reportProgress(.running, "Executing...", 10);

        // Use existing PTY system
        var pty = try PTY.openPty(ctx.allocator, ctx.io, .{
            .shell = "bash",
            .cwd = if (ctx.work_dir) |wd| wd.ptr else null,
            .rows = 40,
            .cols = 120,
        });
        defer pty.closePty();

        // Send command
        const cmd_with_nl = try std.fmt.allocPrint(ctx.allocator, "{s}\n", .{cmd});
        defer ctx.allocator.free(cmd_with_nl);

        _ = pty.writeData(cmd_with_nl);

        ctx.reportProgress(.running, "Waiting for output...", 50);

        // Collect output with timeout
        var output_buffer: std.ArrayList(u8) = .empty;
        defer output_buffer.deinit(ctx.allocator);

        const start_time = std.Io.Clock.now(.awake, ctx.io).toMilliseconds();
        while (std.Io.Clock.now(.awake, ctx.io).toMilliseconds() - start_time < timeout) {
            if (ctx.checkAbort()) {
                return ToolResult{
                    .content = try ctx.allocator.dupe(u8, "Cancelled by sibling error"),
                    .is_error = true,
                };
            }

            if (pty.readData()) |data| {
                try output_buffer.appendSlice(ctx.allocator, data);
            }

            if (!pty.alive()) break;

            try std.Io.sleep(ctx.io, .fromMilliseconds(10), .awake);
        }

        ctx.reportProgress(.completed, "Done", 100);

        // Get exit code
        const exit_code = pty.exitCode();
        const is_error = exit_code != 0;

        return ToolResult{
            .content = try output_buffer.toOwnedSlice(ctx.allocator),
            .is_error = is_error,
        };
    }

    fn bashIsConcurrencySafe(input_json: []const u8) bool {
        // Parse and check for && or ; chaining
        var parsed = std.json.parseFromSlice(struct {
            command: []const u8,
        }, std.heap.c_allocator, input_json, .{}) catch return false;
        defer parsed.deinit();

        const cmd = parsed.value.command;

        // Commands with && or ; should run sequentially, not concurrently
        if (std.mem.indexOf(u8, cmd, "&&") != null) return false;
        if (std.mem.indexOf(u8, cmd, ";") != null) return false;

        // Commands that modify shell state are not concurrent-safe
        if (std.mem.startsWith(u8, cmd, "cd ")) return false;
        if (std.mem.startsWith(u8, cmd, "export ")) return false;

        return true;
    }

    fn bashIsReadOnly(input_json: []const u8) bool {
        var parsed = std.json.parseFromSlice(struct {
            command: []const u8,
        }, std.heap.c_allocator, input_json, .{}) catch return false;
        defer parsed.deinit();

        const cmd = parsed.value.command;

        // Read-only commands (safe to run anytime)
        const read_cmds = [_][]const u8{ "ls", "cat", "grep", "find", "head", "tail", "echo", "pwd", "which" };
        for (read_cmds) |rc| {
            if (std.mem.startsWith(u8, cmd, rc)) return true;
        }

        return false;
    }

    fn bashIsDestructive(input_json: []const u8) bool {
        var parsed = std.json.parseFromSlice(struct {
            command: []const u8,
        }, std.heap.c_allocator, input_json, .{}) catch return false;
        defer parsed.deinit();

        const cmd = parsed.value.command;

        // Destructive commands
        const destructive = [_][]const u8{ "rm", "mv", "cp", "dd", ">", ">>" };
        for (destructive) |d| {
            if (std.mem.indexOf(u8, cmd, d) != null) return true;
        }

        return false;
    }

    fn bashModifiesShellState(input_json: []const u8) bool {
        var parsed = std.json.parseFromSlice(struct {
            command: []const u8,
        }, std.heap.c_allocator, input_json, .{}) catch return false;
        defer parsed.deinit();

        const cmd = parsed.value.command;
        return std.mem.startsWith(u8, cmd, "cd ") or
            std.mem.startsWith(u8, cmd, "export ");
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// C FFI Exports
// ═════════════════════════════════════════════════════════════════════════════

export fn tool_registry_create() ?*ToolRegistry {
    const allocator = std.heap.c_allocator;
    const registry = allocator.create(ToolRegistry) catch return null;
    registry.* = ToolRegistry.init(allocator);
    return registry;
}

export fn tool_registry_destroy(registry: *ToolRegistry) void {
    registry.deinit();
    std.heap.c_allocator.destroy(registry);
}

pub fn tool_registry_register(registry: *ToolRegistry, tool: Tool) c_int {
    registry.register(tool) catch return 0;
    return 1;
}

export fn tool_executor_create(io: *const std.Io) ?*ToolExecutor {
    const allocator = std.heap.c_allocator;
    const exec = allocator.create(ToolExecutor) catch return null;
    exec.* = ToolExecutor.init(io.*, allocator);
    return exec;
}

export fn tool_executor_destroy(exec: *ToolExecutor) void {
    exec.deinit();
    std.heap.c_allocator.destroy(exec);
}

pub fn tool_executor_queue(exec: *ToolExecutor, tool: Tool, tool_use_id: [*c]const u8, input_json: [*c]const u8, work_dir: ?[*c]const u8) c_int {
    exec.queue(tool, std.mem.span(tool_use_id), std.mem.span(input_json), if (work_dir) |wd| std.mem.span(wd) else null) catch return 0;
    return 1;
}

export fn tool_executor_wait_all(exec: *ToolExecutor) void {
    exec.waitAll();
}

export fn tool_executor_reset(exec: *ToolExecutor) void {
    exec.reset();
}
