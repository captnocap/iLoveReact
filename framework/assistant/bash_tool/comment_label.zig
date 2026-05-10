//! Comment Label Extraction
//!
//! If the first line of a shell command is a `# comment` (not a `#!` shebang),
//! return the comment text stripped of the `#` prefix. Otherwise null.
//!
//! Under fullscreen mode this is the non-verbose tool-use label AND the
//! collapse-group hint — it's what the assistant wrote for the human to read.

const std = @import("std");

/// Extract the bash comment label from a command
/// Returns null if no comment label found
pub fn extractShellCommentLabel(allocator: std.mem.Allocator, command: []const u8) error{OutOfMemory}!?[]const u8 {
    // Find first newline
    const newline_idx = std.mem.indexOf(u8, command, "\n");
    const first_line = if (newline_idx) |idx|
        command[0..idx]
    else
        command;

    const trimmed = std.mem.trim(u8, first_line, &std.ascii.whitespace);

    // Must start with # but not #! (shebang)
    if (!std.mem.startsWith(u8, trimmed, "#") or std.mem.startsWith(u8, trimmed, "#!")) {
        return null;
    }

    // Strip leading # characters and whitespace
    var start: usize = 0;
    while (start < trimmed.len and trimmed[start] == '#') {
        start += 1;
    }
    while (start < trimmed.len and std.ascii.isWhitespace(trimmed[start])) {
        start += 1;
    }

    const result = trimmed[start..];
    if (result.len == 0) {
        return null;
    }

    return try allocator.dupe(u8, result);
}

// =============================================================================
// Tests
// =============================================================================

test "extract comment label from simple comment" {
    const allocator = std.testing.allocator;

    const result = try extractShellCommentLabel(allocator, "# This is a comment\necho hello");
    defer if (result) |r| allocator.free(r);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("This is a comment", result.?);
}

test "returns null for shebang" {
    const allocator = std.testing.allocator;

    const result = try extractShellCommentLabel(allocator, "#!/bin/bash\necho hello");
    defer if (result) |r| allocator.free(r);

    try std.testing.expect(result == null);
}

test "returns null for no comment" {
    const allocator = std.testing.allocator;

    const result = try extractShellCommentLabel(allocator, "echo hello\n# comment");
    defer if (result) |r| allocator.free(r);

    try std.testing.expect(result == null);
}

test "handles multiple hash characters" {
    const allocator = std.testing.allocator;

    const result = try extractShellCommentLabel(allocator, "### Build the project");
    defer if (result) |r| allocator.free(r);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("Build the project", result.?);
}

test "returns null for empty comment" {
    const allocator = std.testing.allocator;

    const result = try extractShellCommentLabel(allocator, "#   \necho hello");
    defer if (result) |r| allocator.free(r);

    try std.testing.expect(result == null);
}

test "handles single line command without newline" {
    const allocator = std.testing.allocator;

    const result = try extractShellCommentLabel(allocator, "# Build the project");
    defer if (result) |r| allocator.free(r);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("Build the project", result.?);
}
