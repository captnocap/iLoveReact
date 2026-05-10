//! Mode-based Permission Validation
//!
//! Checks if commands should be handled differently based on the current permission mode.
//! Currently handles Accept Edits mode for filesystem commands.

const std = @import("std");

/// Permission mode types
pub const PermissionMode = enum {
    /// Normal mode - ask for approval
    ask,
    /// Accept edits mode - auto-allow filesystem operations
    accept_edits,
    /// Don't ask mode - auto-allow all safe commands
    dont_ask,
    /// Bypass permissions - allow everything (dangerous)
    bypass_permissions,
};

/// Result of mode validation
pub const ModeValidationResult = union(enum) {
    /// Auto-allow based on mode
    allow: struct {
        reason: []const u8,
    },
    /// Passthrough to normal permission flow
    passthrough: struct {
        message: []const u8,
    },
};

/// Commands allowed in accept_edits mode
const ACCEPT_EDITS_ALLOWED_COMMANDS = [_][]const u8{
    "mkdir",
    "touch",
    "rm",
    "rmdir",
    "mv",
    "cp",
    "sed",
};

/// Check if a command is in the filesystem command list
fn isFilesystemCommand(cmd: []const u8) bool {
    for (ACCEPT_EDITS_ALLOWED_COMMANDS) |allowed| {
        if (std.mem.eql(u8, cmd, allowed)) return true;
    }
    return false;
}

/// Extract base command from command string
fn extractBaseCommand(cmd: []const u8) ?[]const u8 {
    const trimmed = std.mem.trim(u8, cmd, &std.ascii.whitespace);
    if (trimmed.len == 0) return null;

    // Find first whitespace
    if (std.mem.indexOfAny(u8, trimmed, &std.ascii.whitespace)) |idx| {
        return trimmed[0..idx];
    }

    return trimmed;
}

/// Validate a single command for mode-specific handling
fn validateCommandForMode(cmd: []const u8, mode: PermissionMode) ModeValidationResult {
    const base_cmd = extractBaseCommand(cmd) orelse {
        return .{ .passthrough = .{ .message = "Base command not found" } };
    };

    // In Accept Edits mode, auto-allow filesystem operations
    if (mode == .accept_edits and isFilesystemCommand(base_cmd)) {
        return .{ .allow = .{ .reason = "accept_edits mode" } };
    }

    return .{ .passthrough = .{ .message = "No mode-specific handling" } };
}

/// Check permission based on current mode
///
/// This is the main entry point for mode-based permission logic.
/// Currently handles Accept Edits mode for filesystem commands,
/// but designed to be extended for other modes.
///
/// Returns:
/// - 'allow' if the current mode permits auto-approval
/// - 'passthrough' if no mode-specific handling applies
pub fn checkPermissionMode(command: []const u8, mode: PermissionMode) ModeValidationResult {
    // Skip if in bypass mode (handled elsewhere)
    if (mode == .bypass_permissions) {
        return .{ .passthrough = .{ .message = "Bypass mode handled elsewhere" } };
    }

    // Skip if in dont_ask mode (handled in main permission flow)
    if (mode == .dont_ask) {
        return .{ .passthrough = .{ .message = "DontAsk mode handled elsewhere" } };
    }

    // For now, handle single commands (compound commands would need parsing)
    return validateCommandForMode(command, mode);
}

/// Get list of auto-allowed commands for a given mode
pub fn getAutoAllowedCommands(mode: PermissionMode) []const []const u8 {
    return if (mode == .accept_edits) &ACCEPT_EDITS_ALLOWED_COMMANDS else &[_][]const u8{};
}

// =============================================================================
// Tests
// =============================================================================

test "accept_edits mode allows filesystem commands" {
    const result = checkPermissionMode("mkdir newdir", .accept_edits);
    try std.testing.expectEqualStrings("accept_edits mode", result.allow.reason);

    const result2 = checkPermissionMode("touch file.txt", .accept_edits);
    try std.testing.expectEqualStrings("accept_edits mode", result2.allow.reason);

    const result3 = checkPermissionMode("rm oldfile", .accept_edits);
    try std.testing.expectEqualStrings("accept_edits mode", result3.allow.reason);
}

test "accept_edits mode passthrough for non-filesystem commands" {
    const result = checkPermissionMode("echo hello", .accept_edits);
    try std.testing.expectEqualStrings("No mode-specific handling", result.passthrough.message);
}

test "ask mode passthrough" {
    const result = checkPermissionMode("mkdir newdir", .ask);
    try std.testing.expectEqualStrings("No mode-specific handling", result.passthrough.message);
}

test "bypass mode passthrough" {
    const result = checkPermissionMode("rm -rf /", .bypass_permissions);
    try std.testing.expectEqualStrings("Bypass mode handled elsewhere", result.passthrough.message);
}

test "getAutoAllowedCommands" {
    const allowed = getAutoAllowedCommands(.accept_edits);
    try std.testing.expectEqual(@as(usize, 7), allowed.len);
    try std.testing.expectEqualStrings("mkdir", allowed[0]);

    const none = getAutoAllowedCommands(.ask);
    try std.testing.expectEqual(@as(usize, 0), none.len);
}
