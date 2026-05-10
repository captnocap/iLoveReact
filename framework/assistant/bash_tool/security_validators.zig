//! Security Validators for Shell Commands
//!
//! This module contains security checks for shell commands to prevent
//! command injection and other security vulnerabilities.
//!
//! SECURITY NOTE: These validators are designed to be conservative.
//! When in doubt, they reject commands and require user approval.

const std = @import("std");

/// Result of a security validation
pub const SecurityResult = union(enum) {
    /// Command passed this validator
    pass,
    /// Command failed this validator - should ask for approval
    ask: struct {
        reason: []const u8,
    },
};

/// Context for validation
pub const ValidationContext = struct {
    /// Original command string
    command: []const u8,
    /// Base command (first word)
    base_command: []const u8,
    /// Command with quotes removed
    unquoted: []const u8,
};

/// Security check IDs for logging
pub const SecurityCheckId = enum(u32) {
    incomplete_commands = 1,
    jq_system_function = 2,
    jq_file_arguments = 3,
    obfuscated_flags = 4,
    shell_metacharacters = 5,
    dangerous_variables = 6,
    newlines = 7,
    command_substitution = 8,
    input_redirection = 9,
    output_redirection = 10,
    ifs_injection = 11,
    git_commit_substitution = 12,
    proc_environ_access = 13,
    malformed_token_injection = 14,
    backslash_escaped_whitespace = 15,
    brace_expansion = 16,
    control_characters = 17,
    unicode_whitespace = 18,
    mid_word_hash = 19,
    zsh_dangerous_commands = 20,
    backslash_escaped_operators = 21,
    comment_quote_desync = 22,
    quoted_newline = 23,
};

/// Zsh-specific dangerous commands that can bypass security checks
const ZSH_DANGEROUS_COMMANDS = std.StaticStringMap(void).initComptime(.{
    .{"zmodload"}, // Gateway to module-based attacks
    .{"emulate"},  // eval-equivalent with -c flag
    .{"sysopen"},  // zsh/system - opens files with fine-grained control
    .{"sysread"},  // zsh/system - reads from file descriptors
    .{"syswrite"}, // zsh/system - writes to file descriptors
    .{"sysseek"},  // zsh/system - seeks on file descriptors
    .{"zpty"},     // zsh/zpty - executes commands on pseudo-terminals
    .{"ztcp"},     // zsh/net/tcp - creates TCP connections
    .{"zsocket"},  // zsh/net/socket - creates Unix/TCP sockets
    .{"zf_rm"},    // zsh/files - builtin rm
    .{"zf_mv"},    // zsh/files - builtin mv
    .{"zf_ln"},    // zsh/files - builtin ln
    .{"zf_chmod"}, // zsh/files - builtin chmod
    .{"zf_chown"}, // zsh/files - builtin chown
    .{"zf_mkdir"}, // zsh/files - builtin mkdir
    .{"zf_rmdir"}, // zsh/files - builtin rmdir
    .{"zf_chgrp"}, // zsh/files - builtin chgrp
});

/// Check if command is empty
pub fn validateEmpty(ctx: ValidationContext) SecurityResult {
    if (std.mem.trim(u8, ctx.command, &std.ascii.whitespace).len == 0) {
        return .pass;
    }
    return .pass; // Continue to other validators
}

/// Check for incomplete command fragments
pub fn validateIncompleteCommands(ctx: ValidationContext) SecurityResult {
    const trimmed = std.mem.trim(u8, ctx.command, &std.ascii.whitespace);

    // Starts with tab (incomplete fragment)
    if (std.mem.startsWith(u8, ctx.command, "\t")) {
        return .{ .ask = .{ .reason = "Command appears to be an incomplete fragment (starts with tab)" } };
    }

    // Starts with dash (flags without command)
    if (std.mem.startsWith(u8, trimmed, "-")) {
        return .{ .ask = .{ .reason = "Command appears to be an incomplete fragment (starts with flags)" } };
    }

    // Starts with operator
    if (std.mem.startsWith(u8, trimmed, "&&") or
        std.mem.startsWith(u8, trimmed, "||") or
        std.mem.startsWith(u8, trimmed, ";") or
        std.mem.startsWith(u8, trimmed, ">>") or
        std.mem.startsWith(u8, trimmed, ">") or
        std.mem.startsWith(u8, trimmed, "<"))
    {
        return .{ .ask = .{ .reason = "Command appears to be a continuation line (starts with operator)" } };
    }

    return .pass;
}

/// Check for jq system() function and dangerous flags
pub fn validateJqCommand(ctx: ValidationContext) SecurityResult {
    if (!std.mem.eql(u8, ctx.base_command, "jq")) {
        return .pass;
    }

    // Check for system() function
    if (simpleContains(ctx.command, "system") and simpleContains(ctx.command, "(")) {
        return .{ .ask = .{ .reason = "jq command contains system() function which executes arbitrary commands" } };
    }

    // Check for dangerous flags
    const dangerous_flags = &[_][]const u8{
        "-f", "--from-file",
        "--rawfile", "--slurpfile",
        "-L", "--library-path",
    };

    for (dangerous_flags) |flag| {
        if (simpleContains(ctx.command, flag)) {
            return .{ .ask = .{ .reason = "jq command contains dangerous flags that could execute code or read arbitrary files" } };
        }
    }

    return .pass;
}

/// Check for shell metacharacters in quoted strings
pub fn validateShellMetacharacters(ctx: ValidationContext) SecurityResult {
    // Check for semicolons, pipes, or ampersands inside quoted strings
    // This is a simplified check - full implementation would be more sophisticated
    if (simpleContains(ctx.unquoted, "\"") and
        (simpleContains(ctx.command, ";\"") or
            simpleContains(ctx.command, "|\"") or
            simpleContains(ctx.command, "&\"")))
    {
        return .{ .ask = .{ .reason = "Command contains shell metacharacters in quoted arguments" } };
    }

    return .pass;
}

/// Check for dangerous variable usage
pub fn validateDangerousVariables(ctx: ValidationContext) SecurityResult {
    // Variables next to pipes or redirections
    if ((simpleContains(ctx.unquoted, "|$") or simpleContains(ctx.unquoted, "<$")) or
        (simpleContains(ctx.unquoted, "$|") or simpleContains(ctx.unquoted, "$>")) or
        (simpleContains(ctx.unquoted, "$<")))
    {
        return .{ .ask = .{ .reason = "Command contains variables in dangerous contexts (redirections or pipes)" } };
    }

    return .pass;
}

/// Check for command substitution patterns
pub fn validateCommandSubstitution(ctx: ValidationContext) SecurityResult {
    const unquoted = ctx.unquoted;

    // Check for unescaped backticks (simplified - doesn't handle escapes)
    if (simpleContains(unquoted, "`")) {
        return .{ .ask = .{ .reason = "Command contains backticks for command substitution" } };
    }

    // Check for $() patterns
    if (simpleContains(unquoted, "$(")) {
        return .{ .ask = .{ .reason = "Command contains $() command substitution" } };
    }

    // Check for ${} parameter expansion
    if (simpleContains(unquoted, "${")) {
        return .{ .ask = .{ .reason = "Command contains ${} parameter substitution" } };
    }

    // Process substitution
    if (simpleContains(unquoted, "<(") or simpleContains(unquoted, ">(")) {
        return .{ .ask = .{ .reason = "Command contains process substitution" } };
    }

    return .pass;
}

/// Check for input/output redirections
pub fn validateRedirections(ctx: ValidationContext) SecurityResult {
    if (simpleContains(ctx.unquoted, "<")) {
        return .{ .ask = .{ .reason = "Command contains input redirection (<) which could read sensitive files" } };
    }

    if (simpleContains(ctx.unquoted, ">")) {
        return .{ .ask = .{ .reason = "Command contains output redirection (>) which could write to arbitrary files" } };
    }

    return .pass;
}

/// Check for newlines (could separate multiple commands)
pub fn validateNewlines(ctx: ValidationContext) SecurityResult {
    const unquoted = ctx.unquoted;

    if (simpleContains(unquoted, "\n") or simpleContains(unquoted, "\r")) {
        return .{ .ask = .{ .reason = "Command contains newlines that could separate multiple commands" } };
    }

    return .pass;
}

/// Check for IFS variable usage
pub fn validateIFSInjection(ctx: ValidationContext) SecurityResult {
    if (simpleContains(ctx.command, "$IFS") or
        (simpleContains(ctx.command, "${") and simpleContains(ctx.command, "IFS")))
    {
        return .{ .ask = .{ .reason = "Command contains IFS variable usage which could bypass security validation" } };
    }

    return .pass;
}

/// Check for /proc environ access
pub fn validateProcEnvironAccess(ctx: ValidationContext) SecurityResult {
    if (simpleContains(ctx.command, "/proc/") and simpleContains(ctx.command, "/environ")) {
        return .{ .ask = .{ .reason = "Command accesses /proc/*/environ which could expose sensitive environment variables" } };
    }

    return .pass;
}

/// Check for ANSI-C quoting and other obfuscated flag patterns
pub fn validateObfuscatedFlags(ctx: ValidationContext) SecurityResult {
    // Block ANSI-C quoting ($'...')
    if (simpleContains(ctx.command, "$'")) {
        return .{ .ask = .{ .reason = "Command contains ANSI-C quoting which can hide characters" } };
    }

    // Block locale quoting ($"...")
    if (simpleContains(ctx.command, "$\"")) {
        return .{ .ask = .{ .reason = "Command contains locale quoting which can hide characters" } };
    }

    // Check for empty quotes followed by dash
    if (simpleContains(ctx.command, "$''-") or simpleContains(ctx.command, "$\"\"-")) {
        return .{ .ask = .{ .reason = "Command contains empty special quotes before dash (potential bypass)" } };
    }

    // Check for consecutive quotes at word start
    if (simpleWordContains(ctx.command, "\"\"\"") or
        simpleWordContains(ctx.command, "'''"))
    {
        return .{ .ask = .{ .reason = "Command contains consecutive quote characters at word start (potential obfuscation)" } };
    }

    return .pass;
}

/// Check for Zsh dangerous commands
pub fn validateZshDangerousCommands(ctx: ValidationContext) SecurityResult {
    if (ZSH_DANGEROUS_COMMANDS.has(ctx.base_command)) {
        return .{ .ask = .{ .reason = "Command is a Zsh builtin that can bypass security checks" } };
    }

    return .pass;
}

/// Check for git commit with command substitution in message
pub fn validateGitCommit(ctx: ValidationContext) SecurityResult {
    if (!std.mem.eql(u8, ctx.base_command, "git")) {
        return .pass;
    }

    // Check if it's a commit command
    if (!simpleContains(ctx.command, "commit")) {
        return .pass;
    }

    // Check for backslashes (simplified validation)
    if (simpleContains(ctx.command, "\\")) {
        return .{ .ask = .{ .reason = "Git commit contains backslash, needs full validation" } };
    }

    // Check for command substitution in -m argument (simplified)
    // A full implementation would parse the -m value properly
    if (simpleContains(ctx.command, "-m") and
        (simpleContains(ctx.command, "$(") or simpleContains(ctx.command, "`")))
    {
        return .{ .ask = .{ .reason = "Git commit message contains command substitution patterns" } };
    }

    return .pass;
}

// =============================================================================
// Helper functions
// =============================================================================

fn simpleContains(haystack: []const u8, needle: []const u8) bool {
    return std.mem.indexOf(u8, haystack, needle) != null;
}

fn simpleWordContains(haystack: []const u8, needle: []const u8) bool {
    // Check if needle appears at word boundary
    var idx: usize = 0;
    while (idx < haystack.len) {
        if (std.mem.startsWith(u8, haystack[idx..], needle)) {
            // Check for word boundary before
            const before_ok = idx == 0 or !isWordChar(haystack[idx - 1]);
            // Check for word boundary after
            const after_ok = idx + needle.len >= haystack.len or
                !isWordChar(haystack[idx + needle.len]);
            if (before_ok and after_ok) return true;
        }
        idx += 1;
    }
    return false;
}

fn isWordChar(c: u8) bool {
    return std.ascii.isAlphanumeric(c) or c == '_';
}

/// Run all security validators on a command
pub fn validateCommandSecurity(command: []const u8) SecurityResult {
    const trimmed = std.mem.trim(u8, command, &std.ascii.whitespace);
    if (trimmed.len == 0) return .pass;

    // Extract base command
    const base_cmd = blk: {
        if (std.mem.indexOfAny(u8, trimmed, &std.ascii.whitespace)) |idx| {
            break :blk trimmed[0..idx];
        }
        break :blk trimmed;
    };

    // Create unquoted version (simplified - just removes quotes)
    var unquoted_buf: [4096]u8 = undefined;
    var unquoted_len: usize = 0;
    for (trimmed) |c| {
        if (c != '\'' and c != '"' and unquoted_len < unquoted_buf.len) {
            unquoted_buf[unquoted_len] = c;
            unquoted_len += 1;
        }
    }
    const unquoted = unquoted_buf[0..unquoted_len];

    const ctx = ValidationContext{
        .command = trimmed,
        .base_command = base_cmd,
        .unquoted = unquoted,
    };

    // Run validators in order
    const validators = &[_]*const fn (ValidationContext) SecurityResult{
        validateEmpty,
        validateIncompleteCommands,
        validateZshDangerousCommands,
        validateCommandSubstitution,
        validateRedirections,
        validateNewlines,
        validateIFSInjection,
        validateProcEnvironAccess,
        validateObfuscatedFlags,
        validateDangerousVariables,
        validateShellMetacharacters,
        validateJqCommand,
        validateGitCommit,
    };

    for (validators) |validator| {
        const result = validator(ctx);
        switch (result) {
            .ask => return result,
            .pass => continue,
        }
    }

    return .pass;
}

// =============================================================================
// Tests
// =============================================================================

test "validateIncompleteCommands catches fragment patterns" {
    const r1 = validateIncompleteCommands(.{ .command = "\techo hello", .base_command = "echo", .unquoted = "echo hello" });
    try std.testing.expect(r1 == .ask);

    const r2 = validateIncompleteCommands(.{ .command = "-l file", .base_command = "-l", .unquoted = "-l file" });
    try std.testing.expect(r2 == .ask);

    const r3 = validateIncompleteCommands(.{ .command = "&& echo hello", .base_command = "echo", .unquoted = "echo hello" });
    try std.testing.expect(r3 == .ask);
}

test "validateCommandSubstitution catches $()" {
    const r1 = validateCommandSubstitution(.{ .command = "echo $(whoami)", .base_command = "echo", .unquoted = "echo $(whoami)" });
    try std.testing.expect(r1 == .ask);

    const r2 = validateCommandSubstitution(.{ .command = "echo hello", .base_command = "echo", .unquoted = "echo hello" });
    try std.testing.expect(r2 == .pass);
}

test "validateRedirections catches > and <" {
    const r1 = validateRedirections(.{ .command = "cat > file", .base_command = "cat", .unquoted = "cat > file" });
    try std.testing.expect(r1 == .ask);

    const r2 = validateRedirections(.{ .command = "cat < file", .base_command = "cat", .unquoted = "cat < file" });
    try std.testing.expect(r2 == .ask);
}

test "validateObfuscatedFlags catches ANSI-C quoting" {
    const r1 = validateObfuscatedFlags(.{ .command = "echo $'\\nhello'", .base_command = "echo", .unquoted = "echo $hello" });
    try std.testing.expect(r1 == .ask);
}

test "validateZshDangerousCommands blocks zmodload" {
    const r1 = validateZshDangerousCommands(.{ .command = "zmodload zsh/mapfile", .base_command = "zmodload", .unquoted = "zmodload zsh/mapfile" });
    try std.testing.expect(r1 == .ask);
}

test "validateIFSInjection catches $IFS" {
    const r1 = validateIFSInjection(.{ .command = "echo $IFS", .base_command = "echo", .unquoted = "echo $IFS" });
    try std.testing.expect(r1 == .ask);
}

test "validateProcEnvironAccess catches /proc environ" {
    const r1 = validateProcEnvironAccess(.{ .command = "cat /proc/self/environ", .base_command = "cat", .unquoted = "cat /proc/self/environ" });
    try std.testing.expect(r1 == .ask);
}
