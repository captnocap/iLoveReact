//! Command semantics configuration for interpreting exit codes in different contexts.
//!
//! Many commands use exit codes to convey information other than just success/failure.
//! For example, grep returns 1 when no matches are found, which is not an error condition.

const std = @import("std");

/// Result of interpreting a command's exit status
pub const CommandInterpretation = struct {
    /// Whether this represents an error condition
    is_error: bool,
    /// Optional human-readable message explaining the result
    message: ?[]const u8 = null,
};

/// Function type for command semantic interpretation
pub const SemanticFn = *const fn (exit_code: i32, stdout: []const u8, stderr: []const u8) CommandInterpretation;

/// Default semantic: treat only 0 as success, everything else as error
fn defaultSemantic(exit_code: i32, _: []const u8, _: []const u8) CommandInterpretation {
    return .{
        .is_error = exit_code != 0,
        .message = if (exit_code != 0)
            std.fmt.comptimePrint("Command failed with exit code {d}", .{exit_code})
        else
            null,
    };
}

/// grep/ripgrep: 0=matches found, 1=no matches, 2+=error
fn grepSemantic(exit_code: i32, _: []const u8, _: []const u8) CommandInterpretation {
    return .{
        .is_error = exit_code >= 2,
        .message = if (exit_code == 1) "No matches found" else null,
    };
}

/// find: 0=success, 1=partial success (some dirs inaccessible), 2+=error
fn findSemantic(exit_code: i32, _: []const u8, _: []const u8) CommandInterpretation {
    return .{
        .is_error = exit_code >= 2,
        .message = if (exit_code == 1) "Some directories were inaccessible" else null,
    };
}

/// diff: 0=no differences, 1=differences found, 2+=error
fn diffSemantic(exit_code: i32, _: []const u8, _: []const u8) CommandInterpretation {
    return .{
        .is_error = exit_code >= 2,
        .message = if (exit_code == 1) "Files differ" else null,
    };
}

/// test/[: 0=condition true, 1=condition false, 2+=error
fn testSemantic(exit_code: i32, _: []const u8, _: []const u8) CommandInterpretation {
    return .{
        .is_error = exit_code >= 2,
        .message = if (exit_code == 1) "Condition is false" else null,
    };
}

/// Map of command names to their semantic functions
const COMMAND_SEMANTICS = std.StaticStringMap(SemanticFn).initComptime(.{
    .{ "grep", grepSemantic },
    .{ "rg", grepSemantic },
    .{ "find", findSemantic },
    .{ "diff", diffSemantic },
    .{ "test", testSemantic },
    .{ "[", testSemantic },
});

/// Extract the base command (first word) from a command string
fn extractBaseCommand(command: []const u8) []const u8 {
    const trimmed = std.mem.trim(u8, command, &std.ascii.whitespace);
    
    // Find first whitespace
    if (std.mem.indexOfAny(u8, trimmed, &std.ascii.whitespace)) |idx| {
        return trimmed[0..idx];
    }
    
    return trimmed;
}

/// Heuristically extract the primary command from a complex command line
/// Takes the last command as that's what determines the exit code
fn heuristicallyExtractBaseCommand(command: []const u8) []const u8 {
    // For now, just extract the base command
    // In full implementation, this would split by pipes and take the last segment
    return extractBaseCommand(command);
}

/// Get the semantic function for a command
fn getCommandSemantic(command: []const u8) SemanticFn {
    const base_cmd = heuristicallyExtractBaseCommand(command);
    return COMMAND_SEMANTICS.get(base_cmd) orelse defaultSemantic;
}

/// Interpret command result based on semantic rules
pub fn interpretCommandResult(
    command: []const u8,
    exit_code: i32,
    stdout: []const u8,
    stderr: []const u8,
) CommandInterpretation {
    const semantic = getCommandSemantic(command);
    return semantic(exit_code, stdout, stderr);
}

// =============================================================================
// Tests
// =============================================================================

test "grep semantic" {
    const expect = std.testing.expect;
    const expectEqualStrings = std.testing.expectEqualStrings;

    // Success with matches
    const r1 = grepSemantic(0, "", "");
    try expect(!r1.is_error);
    try expect(r1.message == null);

    // No matches (not an error)
    const r2 = grepSemantic(1, "", "");
    try expect(!r2.is_error);
    try expect(r2.message != null);
    try expectEqualStrings("No matches found", r2.message.?);

    // Error
    const r3 = grepSemantic(2, "", "file not found");
    try expect(r3.is_error);
}

test "diff semantic" {
    const expect = std.testing.expect;

    // No differences
    const r1 = diffSemantic(0, "", "");
    try expect(!r1.is_error);

    // Differences found (not an error)
    const r2 = diffSemantic(1, "some output", "");
    try expect(!r2.is_error);

    // Error
    const r3 = diffSemantic(2, "", "error");
    try expect(r3.is_error);
}

test "interpretCommandResult with unknown command uses default" {
    const expect = std.testing.expect;

    const r1 = interpretCommandResult("unknown", 0, "", "");
    try expect(!r1.is_error);

    const r2 = interpretCommandResult("unknown", 1, "", "");
    try expect(r2.is_error);
}

test "interpretCommandResult with grep" {
    const expect = std.testing.expect;

    const r1 = interpretCommandResult("grep pattern file", 0, "", "");
    try expect(!r1.is_error);

    const r2 = interpretCommandResult("grep pattern file", 1, "", "");
    try expect(!r2.is_error); // No matches is not an error
}
