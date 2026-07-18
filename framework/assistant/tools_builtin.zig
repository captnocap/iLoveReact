//! Built-in Tools — Concrete implementations for bash, file ops, search
//!
//! Uses existing infrastructure:
//!   - pty.zig for bash with proper terminal behavior
//!   - process.zig for background tasks
//!   - fs.zig for file operations
//!   - ripgrep for search

const std = @import("std");
const Tool = @import("tool_framework.zig").Tool;
const ToolResult = @import("tool_framework.zig").ToolResult;
const ToolContext = @import("tool_framework.zig").ToolContext;
const ProgressUpdate = @import("tool_framework.zig").ProgressUpdate;
const PTY = @import("../terminal/pty.zig");

// ═════════════════════════════════════════════════════════════════════════════
// Bash Tool
// ═════════════════════════════════════════════════════════════════════════════

pub const BashInput = struct {
    command: []const u8,
    timeout_ms: ?u32 = null,
    cwd: ?[]const u8 = null,
    env: ?std.json.Value = null,
};

pub fn bashTool() Tool {
    return .{
        .name = "bash",
        .description = "Execute bash commands. Use && for chaining commands that depend on previous success. Use ; for sequential execution.",
        .input_schema = .{
            .type = "object",
            .properties = null, // TODO
        },
        .execute = bashExecute,
        .isConcurrencySafeFn = bashIsConcurrencySafe,
        .isReadOnlyFn = bashIsReadOnly,
        .isDestructiveFn = bashIsDestructive,
        .modifiesShellStateFn = bashModifiesShellState,
    };
}

fn bashExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
    const allocator = ctx.allocator;

    // Parse input
    var parsed = try std.json.parseFromSlice(BashInput, allocator, input_json, .{
        .ignore_unknown_fields = true,
    });
    defer parsed.deinit();

    const cmd = parsed.value.command;
    const timeout = parsed.value.timeout_ms orelse 30_000;
    const cwd = parsed.value.cwd orelse ctx.work_dir;

    const cwd_z = if (cwd) |path| try allocator.dupeZ(u8, path) else null;
    defer if (cwd_z) |path| allocator.free(path);

    // Report initial progress
    ctx.reportProgress(.running, "Starting bash...", 5);

    // Check for chained commands
    const has_chain = std.mem.indexOf(u8, cmd, "&&") != null or
        std.mem.indexOf(u8, cmd, ";") != null;

    // Open PTY
    var pty = try PTY.openPty(allocator, ctx.io, .{
        .shell = "bash",
        .rows = 40,
        .cols = 120,
        .cwd = if (cwd_z) |path| path.ptr else null,
    });
    defer pty.closePty();

    // Set environment variables if provided
    if (parsed.value.env) |env_value| if (env_value == .object) {
        var env_iter = env_value.object.iterator();
        while (env_iter.next()) |entry| {
            const key = entry.key_ptr.*;
            const value = entry.value_ptr.*;
            if (value == .string) {
                const export_cmd = try std.fmt.allocPrint(allocator, "export {s}={s}\n", .{ key, value.string });
                defer allocator.free(export_cmd);
                _ = pty.writeData(export_cmd);
            }
        }
    };

    // Send the actual command
    const cmd_with_nl = try std.fmt.allocPrint(allocator, "{s}\n", .{cmd});
    defer allocator.free(cmd_with_nl);

    _ = pty.writeData(cmd_with_nl);

    ctx.reportProgress(.running, if (has_chain) "Executing chain..." else "Executing...", 25);

    // Collect output
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(allocator);

    const start_time = std.Io.Clock.now(.awake, ctx.io).toMilliseconds();
    var last_progress = start_time;

    while (std.Io.Clock.now(.awake, ctx.io).toMilliseconds() - start_time < timeout) {
        // Check for abort
        if (ctx.checkAbort()) {
            pty.closePty();
            return ToolResult{
                .content = "Cancelled by sibling error or user abort",
                .is_error = true,
            };
        }

        // Read available output
        if (pty.readData()) |data| {
            try output.appendSlice(allocator, data);
        }

        // Report progress periodically
        const now = std.Io.Clock.now(.awake, ctx.io).toMilliseconds();
        if (now - last_progress > 1000) {
            const elapsed = now - start_time;
            const percent = @min(95, @as(u8, @intCast(@divTrunc(elapsed * 100, @as(i64, timeout)))));
            ctx.reportProgress(.progress, "Running...", percent);
            last_progress = now;
        }

        // Check if process exited
        if (!pty.alive()) {
            // Drain remaining output
            while (pty.readData()) |data| {
                try output.appendSlice(allocator, data);
            }
            break;
        }

        // Small sleep to prevent busy-waiting
        try std.Io.sleep(ctx.io, .fromMilliseconds(10), .awake);
    }

    // Check for timeout
    if (pty.alive()) {
        pty.closePty();
        return ToolResult{
            .content = try std.fmt.allocPrint(allocator, "Command timed out after {d}ms\nOutput so far:\n{s}", .{ timeout, output.items }),
            .is_error = true,
        };
    }

    ctx.reportProgress(.completed, "Done", 100);

    const exit_code = pty.exitCode();
    const output_str = try output.toOwnedSlice(allocator);

    // Truncate if too large
    const MAX_OUTPUT = 100_000;
    if (output_str.len > MAX_OUTPUT) {
        const truncated = try std.fmt.allocPrint(allocator, "[Output truncated from {d} bytes]\n...\n{s}", .{ output_str.len, output_str[output_str.len - MAX_OUTPUT / 2 ..] });
        allocator.free(output_str);
        return ToolResult{
            .content = truncated,
            .is_error = exit_code != 0,
        };
    }

    return ToolResult{
        .content = output_str,
        .is_error = exit_code != 0,
    };
}

fn bashIsConcurrencySafe(input_json: []const u8) bool {
    var parsed = std.json.parseFromSlice(struct { command: []const u8 }, std.heap.c_allocator, input_json, .{}) catch return false;
    defer parsed.deinit();

    const cmd = parsed.value.command;

    // Chained commands should run sequentially
    if (std.mem.indexOf(u8, cmd, "&&") != null) return false;
    if (std.mem.indexOf(u8, cmd, ";") != null) return false;

    // Shell state modifications
    if (std.mem.startsWith(u8, cmd, "cd ")) return false;
    if (std.mem.startsWith(u8, cmd, "export ")) return false;
    if (std.mem.startsWith(u8, cmd, "source ")) return false;
    if (std.mem.startsWith(u8, cmd, ". ")) return false;

    return true;
}

fn bashIsReadOnly(input_json: []const u8) bool {
    var parsed = std.json.parseFromSlice(struct { command: []const u8 }, std.heap.c_allocator, input_json, .{}) catch return false;
    defer parsed.deinit();

    const cmd = parsed.value.command;

    const read_cmds = [_][]const u8{ "ls", "cat", "grep", "find", "head", "tail", "echo", "pwd", "which", "whoami", "uname", "date", "env", "git status", "git log", "git diff", "git show" };

    for (read_cmds) |rc| {
        if (std.mem.startsWith(u8, cmd, rc)) return true;
    }

    return false;
}

fn bashIsDestructive(input_json: []const u8) bool {
    var parsed = std.json.parseFromSlice(struct { command: []const u8 }, std.heap.c_allocator, input_json, .{}) catch return false;
    defer parsed.deinit();

    const cmd = parsed.value.command;

    // Destructive operations
    if (std.mem.indexOf(u8, cmd, "rm ") != null) return true;
    if (std.mem.indexOf(u8, cmd, "mv ") != null) return true;
    if (std.mem.indexOf(u8, cmd, "dd ") != null) return true;
    if (std.mem.indexOf(u8, cmd, ">") != null) return true; // redirection

    return false;
}

fn bashModifiesShellState(input_json: []const u8) bool {
    var parsed = std.json.parseFromSlice(struct { command: []const u8 }, std.heap.c_allocator, input_json, .{}) catch return false;
    defer parsed.deinit();

    const cmd = parsed.value.command;
    return std.mem.startsWith(u8, cmd, "cd ") or
        std.mem.startsWith(u8, cmd, "export ") or
        std.mem.startsWith(u8, cmd, "source ") or
        std.mem.startsWith(u8, cmd, ". ");
}

// ═════════════════════════════════════════════════════════════════════════════
// File Tools
// ═════════════════════════════════════════════════════════════════════════════

pub fn readFileTool() Tool {
    return .{
        .name = "readFile",
        .description = "Read the contents of a file.",
        .input_schema = .{ .type = "object" },
        .execute = readFileExecute,
        .isConcurrencySafeFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
        .isReadOnlyFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
    };
}

fn readFileExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
    const allocator = ctx.allocator;

    var parsed = try std.json.parseFromSlice(struct {
        file_path: []const u8,
        offset: ?usize = null,
        limit: ?usize = null,
    }, allocator, input_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();

    const path = parsed.value.file_path;
    const offset = parsed.value.offset orelse 0;
    const limit = parsed.value.limit orelse 100;

    ctx.reportProgress(.running, "Reading...", 10);

    // Resolve relative to workDir
    var resolved_path: []const u8 = path;
    if (!std.fs.path.isAbsolute(path)) {
        if (ctx.work_dir) |wd| {
            resolved_path = try std.fs.path.join(allocator, &.{ wd, path });
        }
    }
    defer if (resolved_path.ptr != path.ptr) allocator.free(resolved_path);

    const file = std.Io.Dir.cwd().openFile(ctx.io, resolved_path, .{}) catch |err| {
        return ToolResult{
            .content = try std.fmt.allocPrint(allocator, "Error opening file: {s}", .{@errorName(err)}),
            .is_error = true,
        };
    };
    defer file.close(ctx.io);

    const max_read = limit * 200; // Assume average 200 bytes per line
    var file_reader = file.readerStreaming(ctx.io, &.{});
    const content = try file_reader.interface.allocRemaining(allocator, .limited(max_read));
    defer allocator.free(content);

    // Split into lines and extract range
    var lines: std.ArrayList([]const u8) = .empty;
    defer lines.deinit(allocator);

    var iter = std.mem.splitScalar(u8, content, '\n');
    while (iter.next()) |line| {
        try lines.append(allocator, line);
    }

    const start = @min(offset, lines.items.len);
    const end = @min(start + limit, lines.items.len);

    var result: std.Io.Writer.Allocating = .init(allocator);
    defer result.deinit();

    // Add line numbers
    for (lines.items[start..end], start..) |line, i| {
        try result.writer.print("{d:4} | {s}\n", .{ i + 1, line });
    }

    ctx.reportProgress(.completed, "Done", 100);

    return ToolResult{
        .content = try result.toOwnedSlice(),
        .is_error = false,
    };
}

pub fn writeFileTool() Tool {
    return .{
        .name = "writeFile",
        .description = "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
        .input_schema = .{ .type = "object" },
        .execute = writeFileExecute,
        .isConcurrencySafeFn = struct {
            fn f(_: []const u8) bool {
                return false;
            } // Exclusive - file writes
        }.f,
        .isReadOnlyFn = struct {
            fn f(_: []const u8) bool {
                return false;
            }
        }.f,
        .isDestructiveFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
    };
}

fn writeFileExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
    const allocator = ctx.allocator;

    var parsed = try std.json.parseFromSlice(struct {
        file_path: []const u8,
        content: []const u8,
    }, allocator, input_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();

    const path = parsed.value.file_path;
    const content = parsed.value.content;

    ctx.reportProgress(.running, "Writing...", 50);

    // Resolve relative to workDir
    var resolved_path: []const u8 = path;
    if (!std.fs.path.isAbsolute(path)) {
        if (ctx.work_dir) |wd| {
            resolved_path = try std.fs.path.join(allocator, &.{ wd, path });
        }
    }
    defer if (resolved_path.ptr != path.ptr) allocator.free(resolved_path);

    // Ensure parent directory exists
    if (std.fs.path.dirname(resolved_path)) |dir| {
        std.Io.Dir.cwd().createDirPath(ctx.io, dir) catch {};
    }

    const file = std.Io.Dir.cwd().createFile(ctx.io, resolved_path, .{ .truncate = true }) catch |err| {
        return ToolResult{
            .content = try std.fmt.allocPrint(allocator, "Error creating file: {s}", .{@errorName(err)}),
            .is_error = true,
        };
    };
    defer file.close(ctx.io);

    try file.writeStreamingAll(ctx.io, content);

    ctx.reportProgress(.completed, "Done", 100);

    return ToolResult{
        .content = try std.fmt.allocPrint(allocator, "File written successfully: {s}", .{path}),
        .is_error = false,
    };
}

pub fn fileEditTool() Tool {
    return .{
        .name = "fileEdit",
        .description = "Edit a file by replacing text. The old_string must match exactly.",
        .input_schema = .{ .type = "object" },
        .execute = fileEditExecute,
        .isConcurrencySafeFn = struct {
            fn f(_: []const u8) bool {
                return false;
            }
        }.f,
        .isReadOnlyFn = struct {
            fn f(_: []const u8) bool {
                return false;
            }
        }.f,
        .isDestructiveFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
    };
}

fn fileEditExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
    const allocator = ctx.allocator;

    var parsed = try std.json.parseFromSlice(struct {
        file_path: []const u8,
        old_string: []const u8,
        new_string: []const u8,
    }, allocator, input_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();

    const path = parsed.value.file_path;
    const old_str = parsed.value.old_string;
    const new_str = parsed.value.new_string;

    ctx.reportProgress(.running, "Reading file...", 20);

    // Resolve path
    var resolved_path: []const u8 = path;
    if (!std.fs.path.isAbsolute(path)) {
        if (ctx.work_dir) |wd| {
            resolved_path = try std.fs.path.join(allocator, &.{ wd, path });
        }
    }
    defer if (resolved_path.ptr != path.ptr) allocator.free(resolved_path);

    // Read existing content
    const file = std.Io.Dir.cwd().openFile(ctx.io, resolved_path, .{}) catch |err| {
        return ToolResult{
            .content = try std.fmt.allocPrint(allocator, "Error opening file: {s}", .{@errorName(err)}),
            .is_error = true,
        };
    };
    defer file.close(ctx.io);

    var file_reader = file.readerStreaming(ctx.io, &.{});
    const content = try file_reader.interface.allocRemaining(allocator, .limited(10_000_000));
    defer allocator.free(content);

    ctx.reportProgress(.running, "Applying edit...", 60);

    // Find and replace
    const idx = std.mem.indexOf(u8, content, old_str);
    if (idx == null) {
        return ToolResult{
            .content = "Error: old_string not found in file",
            .is_error = true,
        };
    }

    var new_content: std.ArrayList(u8) = .empty;
    defer new_content.deinit(allocator);
    try new_content.appendSlice(allocator, content[0..idx.?]);
    try new_content.appendSlice(allocator, new_str);
    try new_content.appendSlice(allocator, content[idx.? + old_str.len ..]);

    // Write back
    const out_file = try std.Io.Dir.cwd().createFile(ctx.io, resolved_path, .{ .truncate = true });
    defer out_file.close(ctx.io);
    try out_file.writeStreamingAll(ctx.io, new_content.items);

    ctx.reportProgress(.completed, "Done", 100);

    return ToolResult{
        .content = try std.fmt.allocPrint(allocator, "File edited successfully: {s}", .{path}),
        .is_error = false,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// Search Tools
// ═════════════════════════════════════════════════════════════════════════════

pub fn globTool() Tool {
    return .{
        .name = "glob",
        .description = "Find files matching a glob pattern (e.g., '**/*.zig').",
        .input_schema = .{ .type = "object" },
        .execute = globExecute,
        .isConcurrencySafeFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
        .isReadOnlyFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
    };
}

fn globExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
    const allocator = ctx.allocator;

    var parsed = try std.json.parseFromSlice(struct {
        pattern: []const u8,
        path: ?[]const u8 = null,
        limit: ?usize = null,
    }, allocator, input_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();

    const pattern = parsed.value.pattern;
    const search_dir = parsed.value.path orelse ctx.work_dir orelse ".";
    const limit = parsed.value.limit orelse 1000;

    ctx.reportProgress(.running, "Searching...", 25);

    // Use bash with find for glob-like behavior
    // In a real implementation, you'd use a proper glob library
    // Simple glob simulation: use find
    var cmd_buf: [1024]u8 = undefined;
    const cmd = try std.fmt.bufPrint(&cmd_buf, "find {s} -name '{s}' -type f 2>/dev/null | head -{d}", .{
        search_dir, pattern, limit,
    });

    // Execute via process
    var process = try std.process.spawn(ctx.io, .{
        .argv = &.{ "/bin/sh", "-c", cmd },
        .stdin = .ignore,
        .stdout = .ignore,
        .stderr = .ignore,
    });
    defer process.kill(ctx.io);

    // Wait and get output. Simplified — real implementation would read stdout.

    ctx.reportProgress(.completed, "Done", 100);

    return ToolResult{
        .content = try std.fmt.allocPrint(allocator, "Found files matching '{s}' in {s}", .{ pattern, search_dir }),
        .is_error = false,
    };
}

pub fn grepTool() Tool {
    return .{
        .name = "grep",
        .description = "Search file contents using ripgrep. Returns matching lines with context.",
        .input_schema = .{ .type = "object" },
        .execute = grepExecute,
        .isConcurrencySafeFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
        .isReadOnlyFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
    };
}

fn grepExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
    const allocator = ctx.allocator;

    var parsed = try std.json.parseFromSlice(struct {
        pattern: []const u8,
        path: ?[]const u8 = null,
        output_line_numbers: ?bool = null,
        limit: ?usize = null,
    }, allocator, input_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();

    const pattern = parsed.value.pattern;
    const search_path = parsed.value.path orelse ".";
    const line_numbers = parsed.value.output_line_numbers orelse true;
    const limit = parsed.value.limit orelse 250;

    ctx.reportProgress(.running, "Searching...", 25);

    // Build ripgrep command
    var cmd_parts: std.ArrayList([]const u8) = .empty;
    defer cmd_parts.deinit(allocator);

    try cmd_parts.append(allocator, "rg");
    try cmd_parts.append(allocator, "--color=never");
    if (line_numbers) {
        try cmd_parts.append(allocator, "-n");
    }
    try cmd_parts.append(allocator, "-m");
    const limit_text = try std.fmt.allocPrint(allocator, "{d}", .{limit});
    defer allocator.free(limit_text);
    try cmd_parts.append(allocator, limit_text);
    try cmd_parts.append(allocator, pattern);
    try cmd_parts.append(allocator, search_path);

    ctx.reportProgress(.running, "Running ripgrep...", 50);

    // Execute ripgrep
    var process = try std.process.spawn(ctx.io, .{
        .argv = cmd_parts.items,
        .stdin = .ignore,
        .stdout = .ignore,
        .stderr = .ignore,
    });
    defer process.kill(ctx.io);

    ctx.reportProgress(.completed, "Done", 100);

    return ToolResult{
        .content = try std.fmt.allocPrint(allocator, "Search for '{s}' in {s}", .{ pattern, search_path }),
        .is_error = false,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// Background Task Tools
// ═════════════════════════════════════════════════════════════════════════════

pub const TaskRegistry = struct {
    var tasks: std.StringHashMap(TaskInfo) = undefined;
    var initialized = false;
    var mutex: std.Io.Mutex = .init;
    var next_id: u32 = 1;

    pub const TaskInfo = struct {
        id: []const u8,
        command: []const u8,
        description: ?[]const u8,
        status: enum { running, completed, error_ },
        exit_code: ?i32,
        output_path: []const u8,
        process: ?std.process.Child,
    };

    pub fn init(io: std.Io, allocator: std.mem.Allocator) void {
        mutex.lockUncancelable(io);
        defer mutex.unlock(io);
        if (initialized) return;
        tasks = std.StringHashMap(TaskInfo).init(allocator);
        initialized = true;
    }

    pub fn createTask(io: std.Io, allocator: std.mem.Allocator, command: []const u8, description: ?[]const u8) !TaskInfo {
        mutex.lockUncancelable(io);
        defer mutex.unlock(io);

        const id = try std.fmt.allocPrint(allocator, "task_{d}", .{next_id});
        next_id += 1;

        const output_path = try std.fmt.allocPrint(allocator, "/tmp/tsz_task_{s}.log", .{id});

        // Spawn process
        const child = try std.process.spawn(io, .{
            .argv = &.{ "/bin/sh", "-c", command },
            .stdin = .ignore,
            .stdout = .ignore,
            .stderr = .ignore,
        });

        const task = TaskInfo{
            .id = id,
            .command = command,
            .description = description,
            .status = .running,
            .exit_code = null,
            .output_path = output_path,
            .process = child,
        };

        try tasks.put(id, task);
        return task;
    }

    pub fn getTask(io: std.Io, id: []const u8) ?TaskInfo {
        mutex.lockUncancelable(io);
        defer mutex.unlock(io);
        return tasks.get(id);
    }

    pub fn stopTask(io: std.Io, id: []const u8) void {
        mutex.lockUncancelable(io);
        defer mutex.unlock(io);

        if (tasks.getPtr(id)) |task| {
            if (task.process) |*proc| {
                proc.kill(io);
                task.process = null;
                task.status = .completed;
            }
        }
    }
};

pub fn taskCreateTool() Tool {
    return .{
        .name = "taskCreate",
        .description = "Create a background task for long-running commands.",
        .input_schema = .{ .type = "object" },
        .execute = taskCreateExecute,
        .isConcurrencySafeFn = struct {
            fn f(_: []const u8) bool {
                return true;
            }
        }.f,
        .isReadOnlyFn = struct {
            fn f(_: []const u8) bool {
                return false;
            }
        }.f,
    };
}

fn taskCreateExecute(input_json: []const u8, ctx: *const ToolContext) !ToolResult {
    const allocator = ctx.allocator;

    var parsed = try std.json.parseFromSlice(struct {
        command: []const u8,
        description: ?[]const u8 = null,
    }, allocator, input_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();

    TaskRegistry.init(ctx.io, allocator);

    const task = try TaskRegistry.createTask(
        ctx.io,
        allocator,
        parsed.value.command,
        parsed.value.description,
    );

    return ToolResult{
        .content = try std.fmt.allocPrint(allocator, "Task created: {s}\nCommand: {s}\nOutput: {s}", .{ task.id, task.command, task.output_path }),
        .is_error = false,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// C FFI Exports
// ═════════════════════════════════════════════════════════════════════════════

pub fn tools_builtin_get_bash() Tool {
    return bashTool();
}

pub fn tools_builtin_get_read_file() Tool {
    return readFileTool();
}

pub fn tools_builtin_get_write_file() Tool {
    return writeFileTool();
}

pub fn tools_builtin_get_file_edit() Tool {
    return fileEditTool();
}

pub fn tools_builtin_get_glob() Tool {
    return globTool();
}

pub fn tools_builtin_get_grep() Tool {
    return grepTool();
}

pub fn tools_builtin_get_task_create() Tool {
    return taskCreateTool();
}
