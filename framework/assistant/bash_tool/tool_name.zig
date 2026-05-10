//! Shell Tool Name
//! White-label shell execution tool

/// Name of the shell tool
pub const SHELL_TOOL_NAME = "Shell";

/// Legacy name for backward compatibility
pub const LEGACY_SHELL_TOOL_NAME = "Bash";

// =============================================================================
// Tests
// =============================================================================

test "tool names" {
    try std.testing.expectEqualStrings("Shell", SHELL_TOOL_NAME);
    try std.testing.expectEqualStrings("Bash", LEGACY_SHELL_TOOL_NAME);
}

const std = @import("std");
