//! argv builder for the claude subprocess.
//!
//! Rewritten from codeberg/duhnist/claude-code-sdk-zig argv.zig for 0.15.2.
//! MCP config and advanced flags deferred — expand as the cockpit needs them.

const std = @import("std");
const options = @import("options.zig");

/// Locate the claude binary. Checks opts.cli_path first, then searches PATH.
/// Returns an owned string — caller frees.
pub fn findBinary(allocator: std.mem.Allocator, cli_path: ?[]const u8) ![]const u8 {
    if (cli_path) |p| return allocator.dupe(u8, p);

    const path_env = std.posix.getenv("PATH") orelse return error.BinaryNotFound;

    var it = std.mem.tokenizeScalar(u8, path_env, std.fs.path.delimiter);
    while (it.next()) |dir| {
        const full = try std.fs.path.join(allocator, &.{ dir, "claude" });
        std.fs.accessAbsolute(full, .{}) catch {
            allocator.free(full);
            continue;
        };
        return full;
    }

    return error.BinaryNotFound;
}

/// Build argv for a bidirectional session. Adds --input-format stream-json.
/// All strings are owned by the caller's allocator — free via freeArgv().
pub fn buildSessionArgv(
    allocator: std.mem.Allocator,
    binary: []const u8,
    opts: options.SessionOptions,
) ![]const []const u8 {
    var list: std.ArrayList([]const u8) = .{};
    errdefer {
        for (list.items) |s| allocator.free(s);
        list.deinit(allocator);
    }

    try list.append(allocator, try allocator.dupe(u8, binary));

    // Always stream-json for sessions.
    try list.append(allocator, try allocator.dupe(u8, "--input-format"));
    try list.append(allocator, try allocator.dupe(u8, "stream-json"));
    try list.append(allocator, try allocator.dupe(u8, "--output-format"));
    try list.append(allocator, try allocator.dupe(u8, "stream-json"));

    // --verbose is required for stream-json when stdin is not a TTY.
    if (opts.verbose) {
        try list.append(allocator, try allocator.dupe(u8, "--verbose"));
    }

    if (opts.model) |m| {
        try list.append(allocator, try allocator.dupe(u8, "--model"));
        try list.append(allocator, try allocator.dupe(u8, m));
    }

    if (opts.system_prompt) |sp| {
        try list.append(allocator, try allocator.dupe(u8, "--system-prompt"));
        try list.append(allocator, try allocator.dupe(u8, sp));
    }

    if (opts.allowed_tools.len > 0) {
        try list.append(allocator, try allocator.dupe(u8, "--allowedTools"));
        const joined = try std.mem.join(allocator, ",", opts.allowed_tools);
        try list.append(allocator, joined);
    }

    if (opts.disallowed_tools.len > 0) {
        try list.append(allocator, try allocator.dupe(u8, "--disallowedTools"));
        const joined = try std.mem.join(allocator, ",", opts.disallowed_tools);
        try list.append(allocator, joined);
    }

    switch (opts.permission_mode) {
        .bypass_permissions => {
            try list.append(allocator, try allocator.dupe(u8, "--dangerously-skip-permissions"));
        },
        else => {
            try list.append(allocator, try allocator.dupe(u8, "--permission-mode"));
            try list.append(allocator, try allocator.dupe(u8, opts.permission_mode.toCli()));
        },
    }

    if (opts.max_turns) |n| {
        try list.append(allocator, try allocator.dupe(u8, "--max-turns"));
        var buf: [16]u8 = undefined;
        const s = try std.fmt.bufPrint(&buf, "{d}", .{n});
        try list.append(allocator, try allocator.dupe(u8, s));
    }

    if (opts.resume_session) |sid| {
        try list.append(allocator, try allocator.dupe(u8, "--resume"));
        try list.append(allocator, try allocator.dupe(u8, sid));
    } else if (opts.continue_conversation) {
        try list.append(allocator, try allocator.dupe(u8, "--continue"));
    }

    for (opts.add_dirs) |d| {
        try list.append(allocator, try allocator.dupe(u8, "--add-dir"));
        try list.append(allocator, try allocator.dupe(u8, d));
    }

    return list.toOwnedSlice(allocator);
}

pub fn freeArgv(allocator: std.mem.Allocator, argv: []const []const u8) void {
    for (argv) |s| allocator.free(s);
    allocator.free(argv);
}
