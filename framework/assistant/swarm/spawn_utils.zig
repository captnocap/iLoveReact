//! Spawn Utilities for Team Members
//!
//! Shared utilities for spawning teammates across different backends.

const std = @import("std");
const constants = @import("constants.zig");

/// Environment variables to forward to spawned teammates
const TEAMMATE_ENV_VARS = [_][]const u8{
    "ANTHROPIC_BASE_URL",
    "AGENT_CONFIG_DIR",
    "AGENT_REMOTE",
    "AGENT_REMOTE_MEMORY_DIR",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "NO_PROXY",
    "no_proxy",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
};

/// Permission mode for CLI flags
pub const PermissionMode = enum {
    ask,
    accept_edits,
    dont_ask,
    bypass_permissions,
};

/// CLI flag builder options
pub const CliFlagOptions = struct {
    plan_mode_required: bool = false,
    permission_mode: ?PermissionMode = null,
    model_override: ?[]const u8 = null,
    settings_path: ?[]const u8 = null,
    chrome_override: ?bool = null,
};

/// Get the command to use for spawning team members
/// Checks TEAMMATE_COMMAND_ENV_VAR first, then falls back to default
pub fn getTeammateCommand(environ_map: *const std.process.Environ.Map) ?[]const u8 {
    // Check environment variable first
    if (environ_map.get(constants.TEAMMATE_COMMAND_ENV_VAR)) |cmd| return cmd;

    // Try legacy env var
    if (environ_map.get(constants.LEGACY_TEAMMATE_COMMAND_ENV_VAR)) |cmd| return cmd;

    return null;
}

/// Build inherited CLI flags for teammates
pub fn buildInheritedCliFlags(
    allocator: std.mem.Allocator,
    options: CliFlagOptions,
) error{OutOfMemory}![]const u8 {
    var flags: std.ArrayList(u8) = .empty;
    defer flags.deinit(allocator);

    // Permission mode flags
    if (!options.plan_mode_required) {
        if (options.permission_mode) |mode| {
            switch (mode) {
                .bypass_permissions => try appendPart(allocator, &flags, "--dangerously-skip-permissions"),
                .accept_edits => try appendPart(allocator, &flags, "--permission-mode acceptEdits"),
                else => {},
            }
        }
    }

    // Model override
    if (options.model_override) |model| {
        const flag = try std.fmt.allocPrint(allocator, "--model {s}", .{model});
        defer allocator.free(flag);
        try appendPart(allocator, &flags, flag);
    }

    // Settings path
    if (options.settings_path) |path| {
        const flag = try std.fmt.allocPrint(allocator, "--settings {s}", .{path});
        defer allocator.free(flag);
        try appendPart(allocator, &flags, flag);
    }

    // Chrome flag
    if (options.chrome_override) |chrome| {
        if (chrome) {
            try appendPart(allocator, &flags, "--chrome");
        } else {
            try appendPart(allocator, &flags, "--no-chrome");
        }
    }

    return try flags.toOwnedSlice(allocator);
}

/// Build environment variable string for teammate spawn
pub fn buildInheritedEnvVars(
    environ_map: *const std.process.Environ.Map,
    allocator: std.mem.Allocator,
) error{OutOfMemory}![]const u8 {
    var env_vars: std.ArrayList(u8) = .empty;
    defer env_vars.deinit(allocator);

    // Base env vars
    try appendPart(allocator, &env_vars, "AGENTCODE=1");
    try appendPart(allocator, &env_vars, "AGENT_EXPERIMENTAL_TEAMS=1");

    // Forward configured env vars
    for (TEAMMATE_ENV_VARS) |key| {
        if (environ_map.get(key)) |value| {
            const assignment = try std.fmt.allocPrint(allocator, "{s}={s}", .{ key, value });
            defer allocator.free(assignment);
            try appendPart(allocator, &env_vars, assignment);
        } else {
            // Env var not set, skip
        }
    }

    return try env_vars.toOwnedSlice(allocator);
}

fn appendPart(allocator: std.mem.Allocator, out: *std.ArrayList(u8), part: []const u8) !void {
    if (out.items.len > 0) try out.append(allocator, ' ');
    try out.appendSlice(allocator, part);
}

/// Quote a string for shell safety (simplified)
pub fn shellQuote(allocator: std.mem.Allocator, s: []const u8) error{OutOfMemory}![]const u8 {
    // Check if quoting is needed
    var needs_quote = false;
    for (s) |c| {
        if (std.ascii.isWhitespace(c) or c == '"' or c == '\'' or c == '$' or c == '`') {
            needs_quote = true;
            break;
        }
    }

    if (!needs_quote) {
        return try allocator.dupe(u8, s);
    }

    // Use single quotes and escape any single quotes in the string
    var result: std.ArrayList(u8) = .empty;
    defer result.deinit(allocator);

    try result.append(allocator, '\'');
    for (s) |c| {
        if (c == '\'') {
            try result.appendSlice(allocator, "'\"'\"'");
        } else {
            try result.append(allocator, c);
        }
    }
    try result.append(allocator, '\'');

    return try result.toOwnedSlice(allocator);
}

// =============================================================================
// Tests
// =============================================================================

test "buildInheritedCliFlags with permission mode" {
    const allocator = std.testing.allocator;

    const flags = try buildInheritedCliFlags(allocator, .{
        .permission_mode = .accept_edits,
    });
    defer allocator.free(flags);

    try std.testing.expect(std.mem.indexOf(u8, flags, "--permission-mode acceptEdits") != null);
}

test "buildInheritedCliFlags with bypass permissions" {
    const allocator = std.testing.allocator;

    const flags = try buildInheritedCliFlags(allocator, .{
        .permission_mode = .bypass_permissions,
    });
    defer allocator.free(flags);

    try std.testing.expect(std.mem.indexOf(u8, flags, "--dangerously-skip-permissions") != null);
}

test "buildInheritedCliFlags with model override" {
    const allocator = std.testing.allocator;

    const flags = try buildInheritedCliFlags(allocator, .{
        .model_override = "gpt-4",
    });
    defer allocator.free(flags);

    try std.testing.expect(std.mem.indexOf(u8, flags, "--model gpt-4") != null);
}

test "shellQuote handles simple string" {
    const allocator = std.testing.allocator;

    const quoted = try shellQuote(allocator, "simple");
    defer allocator.free(quoted);

    try std.testing.expectEqualStrings("simple", quoted);
}

test "shellQuote handles string with spaces" {
    const allocator = std.testing.allocator;

    const quoted = try shellQuote(allocator, "hello world");
    defer allocator.free(quoted);

    try std.testing.expect(std.mem.startsWith(u8, quoted, "'"));
    try std.testing.expect(std.mem.endsWith(u8, quoted, "'"));
}
