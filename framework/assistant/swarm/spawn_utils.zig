//! Spawn Utilities for Team Members
//!
//! Shared utilities for spawning teammates across different backends.

const std = @import("std");
const host_io = @import("../../host_io.zig");
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
pub fn getTeammateCommand() ?[]const u8 {
    // Check environment variable first
    if (host_io.getEnvVarOwned(std.heap.page_allocator, constants.TEAMMATE_COMMAND_ENV_VAR)) |cmd| {
        return cmd;
    } else |_| {}

    // Try legacy env var
    if (host_io.getEnvVarOwned(std.heap.page_allocator, constants.LEGACY_TEAMMATE_COMMAND_ENV_VAR)) |cmd| {
        return cmd;
    } else |_| {}

    return null;
}

/// Build inherited CLI flags for teammates
pub fn buildInheritedCliFlags(
    allocator: std.mem.Allocator,
    options: CliFlagOptions,
) error{OutOfMemory}![]const u8 {
    var flags = std.ArrayList([]const u8).init(allocator);
    defer flags.deinit();

    // Permission mode flags
    if (!options.plan_mode_required) {
        if (options.permission_mode) |mode| {
            switch (mode) {
                .bypass_permissions => try flags.append("--dangerously-skip-permissions"),
                .accept_edits => try flags.append("--permission-mode acceptEdits"),
                else => {},
            }
        }
    }

    // Model override
    if (options.model_override) |model| {
        try flags.append(try std.fmt.allocPrint(allocator, "--model {s}", .{model}));
    }

    // Settings path
    if (options.settings_path) |path| {
        try flags.append(try std.fmt.allocPrint(allocator, "--settings {s}", .{path}));
    }

    // Chrome flag
    if (options.chrome_override) |chrome| {
        if (chrome) {
            try flags.append("--chrome");
        } else {
            try flags.append("--no-chrome");
        }
    }

    return try std.mem.join(allocator, " ", flags.items);
}

/// Build environment variable string for teammate spawn
pub fn buildInheritedEnvVars(allocator: std.mem.Allocator) error{OutOfMemory}![]const u8 {
    var env_vars = std.ArrayList([]const u8).init(allocator);
    defer env_vars.deinit();

    // Base env vars
    try env_vars.append("AGENTCODE=1");
    try env_vars.append("AGENT_EXPERIMENTAL_TEAMS=1");

    // Forward configured env vars
    for (TEAMMATE_ENV_VARS) |key| {
        if (host_io.getEnvVarOwned(allocator, key)) |value| {
            defer allocator.free(value);
            try env_vars.append(try std.fmt.allocPrint(allocator, "{s}={s}", .{ key, value }));
        } else |_| {
            // Env var not set, skip
        }
    }

    return try std.mem.join(allocator, " ", env_vars.items);
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
    var result = std.ArrayList(u8).init(allocator);
    defer result.deinit();

    try result.append('\'');
    for (s) |c| {
        if (c == '\'') {
            try result.appendSlice("'\"'\"'");
        } else {
            try result.append(c);
        }
    }
    try result.append('\'');

    return try result.toOwnedSlice();
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
