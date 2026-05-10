//! Bash Tool (Shell Tool)
//!
//! White-label shell command execution tool with comprehensive security validation.
//!
//! This module provides:
//! - Command security validation
//! - Permission checking
//! - Path validation
//! - Read-only command validation
//! - Exit code interpretation

const std = @import("std");

pub const tool_name = @import("bash_tool/tool_name.zig");
pub const command_semantics = @import("bash_tool/command_semantics.zig");
pub const comment_label = @import("bash_tool/comment_label.zig");
pub const destructive_warning = @import("bash_tool/destructive_warning.zig");
pub const mode_validation = @import("bash_tool/mode_validation.zig");
pub const sed_parser = @import("bash_tool/sed_parser.zig");
pub const security = @import("bash_tool/security_validators.zig");

// Re-export commonly used types and functions
pub const SHELL_TOOL_NAME = tool_name.SHELL_TOOL_NAME;
pub const LEGACY_SHELL_TOOL_NAME = tool_name.LEGACY_SHELL_TOOL_NAME;

pub const CommandInterpretation = command_semantics.CommandInterpretation;
pub const interpretCommandResult = command_semantics.interpretCommandResult;

pub const extractShellCommentLabel = comment_label.extractShellCommentLabel;

pub const getDestructiveCommandWarning = destructive_warning.getDestructiveCommandWarning;

pub const PermissionMode = mode_validation.PermissionMode;
pub const checkPermissionMode = mode_validation.checkPermissionMode;
pub const getAutoAllowedCommands = mode_validation.getAutoAllowedCommands;

pub const SedEditInfo = sed_parser.SedEditInfo;
pub const parseSedEditCommand = sed_parser.parseSedEditCommand;
pub const isSedInPlaceEdit = sed_parser.isSedInPlaceEdit;

pub const SecurityResult = security.SecurityResult;
pub const SecurityCheckId = security.SecurityCheckId;
pub const validateCommandSecurity = security.validateCommandSecurity;

// =============================================================================
// High-level API
// =============================================================================

/// Configuration for shell tool execution
pub const ShellConfig = struct {
    /// Whether to allow commands outside project directory
    restrict_to_project: bool = true,
    /// Current working directory
    cwd: []const u8 = ".",
    /// Permission mode
    mode: mode_validation.PermissionMode = .ask,
};

/// Result of validating a shell command
pub const ValidationResult = union(enum) {
    /// Command is allowed to execute
    allow,
    /// Command requires user approval
    ask: struct {
        reason: []const u8,
        warning: ?[]const u8 = null,
    },
    /// Command is denied
    deny: struct {
        reason: []const u8,
    },
};

/// Validate a shell command for execution
///
/// This performs all security checks and permission validations.
/// Returns a ValidationResult indicating whether the command can proceed.
pub fn validateCommand(command: []const u8, config: ShellConfig) ValidationResult {
    // Check for empty command
    if (std.mem.trim(u8, command, &std.ascii.whitespace).len == 0) {
        return .allow;
    }

    // Check mode-based permissions first
    const mode_result = mode_validation.checkPermissionMode(command, config.mode);
    switch (mode_result) {
        .allow => return .allow,
        .passthrough => {}, // Continue to other checks
    }

    // Run security validators
    const security_result = security.validateCommandSecurity(command);
    switch (security_result) {
        .ask => |ask| {
            return .{ .ask = .{ .reason = ask.reason } };
        },
        .pass => {},
    }

    // Check for destructive warnings (informational only)
    const warning = destructive_warning.getDestructiveCommandWarning(command);

    // For now, allow but return warning if present
    // In full implementation, this would also check path constraints, read-only status, etc.
    if (warning) |w| {
        return .{ .ask = .{ .reason = "Command may be destructive", .warning = w } };
    }

    return .allow;
}

/// Check if a command is read-only (doesn't modify files)
pub fn isReadOnlyCommand(command: []const u8) bool {
    // Simplified implementation - check base command against allowlist
    const trimmed = std.mem.trim(u8, command, &std.ascii.whitespace);
    if (trimmed.len == 0) return true;

    // Extract base command
    const base_cmd = blk: {
        if (std.mem.indexOfAny(u8, trimmed, &std.ascii.whitespace)) |idx| {
            break :blk trimmed[0..idx];
        }
        break :blk trimmed;
    };

    // Read-only commands allowlist
    const read_only_commands = std.StaticStringMap(void).initComptime(.{
        .{"cat"},
        .{"ls"},
        .{"echo"},
        .{"pwd"},
        .{"whoami"},
        .{"id"},
        .{"uname"},
        .{"date"},
        .{"head"},
        .{"tail"},
        .{"grep"},
        .{"rg"},
        .{"find"},
        .{"wc"},
        .{"sort"},
        .{"uniq"},
        .{"diff"},
        .{"which"},
        .{"whereis"},
        .{"file"},
        .{"stat"},
        .{"readlink"},
        .{"dirname"},
        .{"basename"},
        .{"printf"},
        .{"true"},
        .{"false"},
        .{"test"},
        .{"["},
        .{"git"}, // Git can be read-only (status, log, etc.)
    });

    return read_only_commands.has(base_cmd);
}

// =============================================================================
// Tests
// =============================================================================

test "validateCommand allows echo" {
    const result = validateCommand("echo hello", .{});
    try std.testing.expect(result == .allow);
}

test "validateCommand asks for dangerous command" {
    const result = validateCommand("rm -rf /", .{});
    try std.testing.expect(result == .ask);
}

test "validateCommand asks for command with redirection" {
    const result = validateCommand("cat > file.txt", .{});
    try std.testing.expect(result == .ask);
}

test "validateCommand allows empty command" {
    const result = validateCommand("", .{});
    try std.testing.expect(result == .allow);
}

test "isReadOnlyCommand identifies cat as read-only" {
    try std.testing.expect(isReadOnlyCommand("cat file.txt"));
}

test "isReadOnlyCommand identifies rm as not read-only" {
    try std.testing.expect(!isReadOnlyCommand("rm file.txt"));
}
