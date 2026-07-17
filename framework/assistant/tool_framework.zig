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
const host_io = @import("../host_io.zig");
const log = @import("../diag/log.zig");
const Process = @import("../process.zig").Process;
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
    tool_use_id: []const u8,
    status: enum { pending, running, progress, completed, error_ },
    message: ?[]const u8 = null,
    percent: ?u8 = null,
};

/// Tool execution context - passed to every tool call
pub const ToolContext = struct {
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
    
    /// Execute the tool (called in worker thread)
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
    context: ToolContext,
    status: enum { queued, executing, completed, yielded },
    result: ?ToolResult,
    promise: ?std.Thread,
};

pub const ToolExecutor = struct {
    allocator: std.mem.Allocator,
    queue: std.ArrayList(QueuedTool),
    mutex: std.Thread.Mutex,
    cond: std.Thread.Condition,
    
    /// Abort state
    has_errored: bool = false,
    errored_tool_description: ?[]const u8 = null,
    should_abort: bool = false,
    
    /// Callbacks
    on_progress: ?*const fn (ctx: ?*anyopaque, update: ProgressUpdate) void = null,
    on_progress_ctx: ?*anyopaque = null,
    on_complete: ?*const fn (ctx: ?*anyopaque, tool_use_id: []const u8, result: ToolResult) void = null,
    on_complete_ctx: ?*anyopaque = null,

    pub fn init(allocator: std.mem.Allocator) ToolExecutor {
        return .{
            .allocator = allocator,
            .queue = std.ArrayList(QueuedTool).init(allocator),
            .mutex = .{},
            .cond = .{},
        };
    }

    pub fn deinit(self: *ToolExecutor) void {
        for (self.queue.items) |*item| {
            self.allocator.free(item.tool_use_id);
            self.allocator.free(item.input_json);
            if (item.result) |*r| r.deinit(self.allocator);
        }
        self.queue.deinit();
    }

    /// Queue a tool for execution. Returns immediately.
    pub fn queue(self: *ToolExecutor, tool: Tool, tool_use_id: []const u8, input_json: []const u8, work_dir: ?[]const u8) !void {
        const id_copy = try self.allocator.dupe(u8, tool_use_id);
        errdefer self.allocator.free(id_copy);
        
        const input_copy = try self.allocator.dupe(u8, input_json);
        errdefer self.allocator.free(input_copy);

        const context = ToolContext{
            .allocator = self.allocator,
            .work_dir = work_dir,
            .tool_use_id = id_copy,
            .on_progress = self.on_progress,
            .on_progress_ctx = self.on_progress_ctx,
            .should_abort = struct {
                fn check(ctx: ?*anyopaque) bool {
                    const exec = @as(*ToolExecutor, @ptrCast(@alignCast(ctx)));
                    return exec.should_abort;
                }
            }.check,
            .should_abort_ctx = self,
        };

        self.mutex.lock();
        defer self.mutex.unlock();

        try self.queue.append(.{
            .tool = tool,
            .tool_use_id = id_copy,
            .input_json = input_copy,
            .context = context,
            .status = .queued,
            .result = null,
            .promise = null,
        });

        // Notify worker thread
        self.cond.signal();
        
        // Start processing if not already running
        self.processQueue();
    }

    /// Check if we can execute a tool based on concurrency rules
    fn canExecute(self: *ToolExecutor, tool: Tool, input_json: []const u8) bool {
        const is_safe = tool.isConcurrencySafe(input_json);
        
        self.mutex.lock();
        defer self.mutex.unlock();

        // Count executing tools
        var executing_count: usize = 0;
        var has_exclusive = false;
        
        for (self.queue.items) |item| {
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
        for (self.queue.items) |*item| {
            if (item.status != .queued) continue;

            if (self.canExecute(item.tool, item.input_json)) {
                self.executeTool(item);
            } else {
                // Can't execute this tool yet
                // If it's not concurrent-safe, stop here (maintain order)
                if (!item.tool.isConcurrencySafe(item.input_json)) break;
            }
        }
    }

    fn executeTool(self: *ToolExecutor, item: *QueuedTool) void {
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

        // Spawn thread for tool execution
        const thread = std.Thread.spawn(.{}, struct {
            fn run(exec: *ToolExecutor, tool_item: *QueuedTool) void {
                const result = tool_item.tool.execute(tool_item.input_json, &tool_item.context) catch |err| {
                    const err_msg = std.fmt.allocPrint(exec.allocator, "Tool error: {s}", .{@errorName(err)}) catch "Unknown error";
                    return ToolResult{
                        .content = err_msg,
                        .is_error = true,
                    };
                };

                exec.mutex.lock();
                defer exec.mutex.unlock();

                tool_item.result = result;
                tool_item.status = .completed;

                // Check for bash errors - trigger sibling abort
                if (tool_item.tool.name.len >= 4 and 
                    std.mem.eql(u8, tool_item.tool.name[0..4], "bash") and 
                    result.is_error) {
                    exec.has_errored = true;
                    exec.errored_tool_description = exec.allocator.dupe(u8, tool_item.tool.name) catch null;
                    exec.should_abort = true;
                }

                // Notify completion
                if (exec.on_complete) |cb| {
                    cb(exec.on_complete_ctx, tool_item.tool_use_id, result);
                }

                // Continue processing queue
                exec.processQueue();
            }
        }.run, .{ self, item }) catch |err| {
            log.err(.tool, "Failed to spawn tool thread: {s}", .{@errorName(err)});
            item.status = .completed;
            item.result = .{
                .content = "Failed to spawn tool execution",
                .is_error = true,
            };
            return;
        };

        item.promise = thread;
    }

    /// Wait for all queued tools to complete
    pub fn waitAll(self: *ToolExecutor) void {
        for (self.queue.items) |*item| {
            if (item.promise) |thread| {
                thread.join();
                item.promise = null;
            }
        }
    }

    /// Get result for a specific tool_use_id
    pub fn getResult(self: *ToolExecutor, tool_use_id: []const u8) ?ToolResult {
        self.mutex.lock();
        defer self.mutex.unlock();

        for (self.queue.items) |item| {
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
        self.mutex.lock();
        defer self.mutex.unlock();
        
        self.should_abort = true;
        
        // Signal all executing tools to check abort
        for (self.queue.items) |*item| {
            if (item.status == .executing) {
                item.context.reportProgress(.error_, "Cancelled", 0);
            }
        }
    }

    /// Reset state for new turn
    pub fn reset(self: *ToolExecutor) void {
        self.waitAll();
        
        for (self.queue.items) |*item| {
            self.allocator.free(item.tool_use_id);
            self.allocator.free(item.input_json);
            if (item.result) |*r| r.deinit(self.allocator);
        }
        
        self.queue.clearRetainingCapacity();
        self.has_errored = false;
        self.errored_tool_description = null;
        self.should_abort = false;
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
            .allocator = self.allocator,
            .work_dir = work_dir,
            .tool_use_id = "sync",
            .on_progress = null,
            .on_progress_ctx = null,
            .should_abort = struct {
                fn check(_: ?*anyopaque) bool { return false; }
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
        var pty = try PTY.openPty(.{
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
        var output_buffer = std.ArrayList(u8).init(ctx.allocator);
        defer output_buffer.deinit();

        const start_time = host_io.milliTimestamp();
        while (host_io.milliTimestamp() - start_time < timeout) {
            if (ctx.checkAbort()) {
                pty.closePty();
                return ToolResult{
                    .content = "Cancelled by sibling error",
                    .is_error = true,
                };
            }

            if (pty.readData()) |data| {
                try output_buffer.appendSlice(data);
            }

            if (!pty.alive()) break;

            std.Thread.sleep(10 * std.time.ns_per_ms);
        }

        ctx.reportProgress(.completed, "Done", 100);

        // Get exit code
        const exit_code = pty.exitCode();
        const is_error = exit_code != 0;

        return ToolResult{
            .content = try output_buffer.toOwnedSlice(),
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
        const read_cmds = &.{ "ls", "cat", "grep", "find", "head", "tail", "echo", "pwd", "which" };
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
        const destructive = &.{ "rm", "mv", "cp", "dd", ">", ">>" };
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

export fn tool_registry_register(registry: *ToolRegistry, tool: Tool) c_int {
    registry.register(tool) catch return 0;
    return 1;
}

export fn tool_executor_create() ?*ToolExecutor {
    const allocator = std.heap.c_allocator;
    const exec = allocator.create(ToolExecutor) catch return null;
    exec.* = ToolExecutor.init(allocator);
    return exec;
}

export fn tool_executor_destroy(exec: *ToolExecutor) void {
    exec.deinit();
    std.heap.c_allocator.destroy(exec);
}

export fn tool_executor_queue(exec: *ToolExecutor, tool: Tool, tool_use_id: [*c]const u8, input_json: [*c]const u8, work_dir: ?[*c]const u8) c_int {
    exec.queue(tool, std.mem.span(tool_use_id), std.mem.span(input_json), if (work_dir) |wd| std.mem.span(wd) else null) catch return 0;
    return 1;
}

export fn tool_executor_wait_all(exec: *ToolExecutor) void {
    exec.waitAll();
}

export fn tool_executor_reset(exec: *ToolExecutor) void {
    exec.reset();
}
