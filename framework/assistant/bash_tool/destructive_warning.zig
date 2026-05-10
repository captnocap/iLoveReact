//! Destructive Command Warning Detection
//!
//! Detects potentially destructive shell commands and returns a warning string
//! for display in the permission dialog. This is purely informational — it
//! doesn't affect permission logic or auto-approval.

const std = @import("std");

const DestructivePattern = struct {
    pattern: []const u8,
    warning: []const u8,
    is_regex: bool = true,
};

// Git patterns
const GIT_RESET_HARD = "\\bgit\\s+reset\\s+--hard\\b";
const GIT_PUSH_FORCE = "\\bgit\\s+push\\b[^;&|\\n]*[ \\t](--force|--force-with-lease|-f)\\b";
const GIT_CLEAN = "\\bgit\\s+clean\\b(?![^;&|\\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\\n]*-[a-zA-Z]*f";
const GIT_CHECKOUT_DOT = "\\bgit\\s+checkout\\s+(--\\s+)?\\.[ \\t]*($|[;&|\\n])";
const GIT_RESTORE_DOT = "\\bgit\\s+restore\\s+(--\\s+)?\\.[ \\t]*($|[;&|\\n])";
const GIT_STASH_DROP = "\\bgit\\s+stash[ \\t]+(drop|clear)\\b";
const GIT_BRANCH_FORCE_DELETE = "\\bgit\\s+branch\\s+(-D[ \\t]|--delete\\s+--force|--force\\s+--delete)\\b";
const GIT_NO_VERIFY = "\\bgit\\s+(commit|push|merge)\\b[^;&|\\n]*--no-verify\\b";
const GIT_COMMIT_AMEND = "\\bgit\\s+commit\\b[^;&|\\n]*--amend\\b";

// File deletion patterns
const RM_RECURSIVE_FORCE = "(^|[;&|\\n]\\s*)rm\\s+-[a-zA-Z]*[rR][a-zA-Z]*f|(^|[;&|\\n]\\s*)rm\\s+-[a-zA-Z]*f[a-zA-Z]*[rR]";
const RM_RECURSIVE = "(^|[;&|\\n]\\s*)rm\\s+-[a-zA-Z]*[rR]";
const RM_FORCE = "(^|[;&|\\n]\\s*)rm\\s+-[a-zA-Z]*f";

// Database patterns
const SQL_DROP = "\\b(DROP|TRUNCATE)\\s+(TABLE|DATABASE|SCHEMA)\\b";
const SQL_DELETE = "\\bDELETE\\s+FROM\\s+\\w+[ \\t]*(;|\"|'|\\n|$)";

// Infrastructure patterns
const KUBECTL_DELETE = "\\bkubectl\\s+delete\\b";
const TERRAFORM_DESTROY = "\\bterraform\\s+destroy\\b";

const DESTRUCTIVE_PATTERNS = [_]DestructivePattern{
    // Git — data loss / hard to reverse
    .{ .pattern = GIT_RESET_HARD, .warning = "Note: may discard uncommitted changes" },
    .{ .pattern = GIT_PUSH_FORCE, .warning = "Note: may overwrite remote history" },
    .{ .pattern = GIT_CLEAN, .warning = "Note: may permanently delete untracked files" },
    .{ .pattern = GIT_CHECKOUT_DOT, .warning = "Note: may discard all working tree changes" },
    .{ .pattern = GIT_RESTORE_DOT, .warning = "Note: may discard all working tree changes" },
    .{ .pattern = GIT_STASH_DROP, .warning = "Note: may permanently remove stashed changes" },
    .{ .pattern = GIT_BRANCH_FORCE_DELETE, .warning = "Note: may force-delete a branch" },

    // Git — safety bypass
    .{ .pattern = GIT_NO_VERIFY, .warning = "Note: may skip safety hooks" },
    .{ .pattern = GIT_COMMIT_AMEND, .warning = "Note: may rewrite the last commit" },

    // File deletion (dangerous paths already handled by checkDangerousRemovalPaths)
    .{ .pattern = RM_RECURSIVE_FORCE, .warning = "Note: may recursively force-remove files" },
    .{ .pattern = RM_RECURSIVE, .warning = "Note: may recursively remove files" },
    .{ .pattern = RM_FORCE, .warning = "Note: may force-remove files" },

    // Database
    .{ .pattern = SQL_DROP, .warning = "Note: may drop or truncate database objects" },
    .{ .pattern = SQL_DELETE, .warning = "Note: may delete all rows from a database table" },

    // Infrastructure
    .{ .pattern = KUBECTL_DELETE, .warning = "Note: may delete Kubernetes resources" },
    .{ .pattern = TERRAFORM_DESTROY, .warning = "Note: may destroy Terraform infrastructure" },
};

/// Simple regex-like matching for common patterns
/// This is a simplified implementation for common destructive patterns
fn matchesPattern(command: []const u8, pattern: []const u8) bool {
    // For now, implement simple string matching for key patterns
    // Full regex implementation would require a regex library

    // Check for git reset --hard
    if (std.mem.eql(u8, pattern, GIT_RESET_HARD)) {
        return simpleWordMatch(command, "git") and
            simpleContains(command, "reset") and
            simpleContains(command, "--hard");
    }

    // Check for git push --force
    if (std.mem.eql(u8, pattern, GIT_PUSH_FORCE)) {
        if (simpleWordMatch(command, "git") and simpleContains(command, "push")) {
            return simpleContains(command, "--force") or
                simpleContains(command, "--force-with-lease") or
                simpleWordMatch(command, "-f");
        }
        return false;
    }

    // Check for git clean -f
    if (std.mem.eql(u8, pattern, GIT_CLEAN)) {
        if (simpleWordMatch(command, "git") and simpleContains(command, "clean")) {
            // Must have -f flag but not -n/--dry-run
            const has_force = simpleContains(command, "-f") or
                simpleContains(command, "-rf") or
                simpleContains(command, "-fr");
            const has_dry_run = simpleContains(command, "-n") or
                simpleContains(command, "--dry-run");
            return has_force and !has_dry_run;
        }
        return false;
    }

    // Check for git checkout / restore .
    if (std.mem.eql(u8, pattern, GIT_CHECKOUT_DOT)) {
        if (simpleWordMatch(command, "git") and simpleContains(command, "checkout")) {
            return simpleEndsWithDot(command) or simpleContains(command, "checkout .");
        }
        return false;
    }

    if (std.mem.eql(u8, pattern, GIT_RESTORE_DOT)) {
        if (simpleWordMatch(command, "git") and simpleContains(command, "restore")) {
            return simpleEndsWithDot(command) or simpleContains(command, "restore .");
        }
        return false;
    }

    // Check for git stash drop/clear
    if (std.mem.eql(u8, pattern, GIT_STASH_DROP)) {
        return simpleWordMatch(command, "git") and
            simpleContains(command, "stash") and
            (simpleContains(command, "drop") or simpleContains(command, "clear"));
    }

    // Check for git branch -D
    if (std.mem.eql(u8, pattern, GIT_BRANCH_FORCE_DELETE)) {
        return simpleWordMatch(command, "git") and
            simpleContains(command, "branch") and
            (simpleContains(command, "-D") or
                (simpleContains(command, "--delete") and simpleContains(command, "--force")));
    }

    // Check for git --no-verify
    if (std.mem.eql(u8, pattern, GIT_NO_VERIFY)) {
        if (simpleWordMatch(command, "git")) {
            const is_commit_push_merge = simpleContains(command, "commit") or
                simpleContains(command, "push") or
                simpleContains(command, "merge");
            return is_commit_push_merge and simpleContains(command, "--no-verify");
        }
        return false;
    }

    // Check for git commit --amend
    if (std.mem.eql(u8, pattern, GIT_COMMIT_AMEND)) {
        return simpleWordMatch(command, "git") and
            simpleContains(command, "commit") and
            simpleContains(command, "--amend");
    }

    // Check for rm -rf patterns
    if (std.mem.eql(u8, pattern, RM_RECURSIVE_FORCE)) {
        return simpleWordMatch(command, "rm") and
            simpleContains(command, "-") and
            simpleContainsAny(command, &.{"-rf", "-fr", "-r", "-R", "-f", "-F"});
    }

    // Check for SQL DROP/TRUNCATE
    if (std.mem.eql(u8, pattern, SQL_DROP)) {
        var buf: [1024]u8 = undefined;
        if (command.len > buf.len) return false;
        const upper_cmd = std.ascii.upperString(&buf, command);
        return (simpleContains(upper_cmd, "DROP") or simpleContains(upper_cmd, "TRUNCATE")) and
            (simpleContains(upper_cmd, "TABLE") or
                simpleContains(upper_cmd, "DATABASE") or
                simpleContains(upper_cmd, "SCHEMA"));
    }

    // Check for kubectl delete
    if (std.mem.eql(u8, pattern, KUBECTL_DELETE)) {
        return simpleWordMatch(command, "kubectl") and simpleContains(command, "delete");
    }

    // Check for terraform destroy
    if (std.mem.eql(u8, pattern, TERRAFORM_DESTROY)) {
        return simpleWordMatch(command, "terraform") and simpleContains(command, "destroy");
    }

    return false;
}

/// Simple word matching - checks if word appears as a whole word
fn simpleWordMatch(command: []const u8, word: []const u8) bool {
    var idx: usize = 0;
    while (idx < command.len) {
        if (std.mem.startsWith(u8, command[idx..], word)) {
            // Check word boundaries
            const before = idx == 0 or !isWordChar(command[idx - 1]);
            const after = idx + word.len >= command.len or !isWordChar(command[idx + word.len]);
            if (before and after) return true;
        }
        idx += 1;
    }
    return false;
}

fn isWordChar(c: u8) bool {
    return std.ascii.isAlphanumeric(c) or c == '_';
}

/// Simple substring check
fn simpleContains(haystack: []const u8, needle: []const u8) bool {
    return std.mem.indexOf(u8, haystack, needle) != null;
}

/// Check if command ends with a single dot (directory reference)
fn simpleEndsWithDot(command: []const u8) bool {
    const trimmed = std.mem.trim(u8, command, &std.ascii.whitespace);
    return trimmed.len >= 2 and
        trimmed[trimmed.len - 1] == '.' and
        std.ascii.isWhitespace(trimmed[trimmed.len - 2]);
}

/// Check if any pattern is contained
fn simpleContainsAny(command: []const u8, patterns: []const []const u8) bool {
    for (patterns) |pattern| {
        if (simpleContains(command, pattern)) return true;
    }
    return false;
}

/// Checks if a command matches known destructive patterns.
/// Returns a warning string, or null if no destructive pattern is detected.
pub fn getDestructiveCommandWarning(command: []const u8) ?[]const u8 {
    for (DESTRUCTIVE_PATTERNS) |pattern| {
        if (matchesPattern(command, pattern.pattern)) {
            return pattern.warning;
        }
    }
    return null;
}

// =============================================================================
// Tests
// =============================================================================

test "detects git reset --hard" {
    try std.testing.expectEqualStrings(
        "Note: may discard uncommitted changes",
        getDestructiveCommandWarning("git reset --hard HEAD~1").?,
    );
}

test "detects git push --force" {
    try std.testing.expectEqualStrings(
        "Note: may overwrite remote history",
        getDestructiveCommandWarning("git push --force origin main").?,
    );
    try std.testing.expectEqualStrings(
        "Note: may overwrite remote history",
        getDestructiveCommandWarning("git push -f origin main").?,
    );
}

test "detects git clean -f" {
    try std.testing.expectEqualStrings(
        "Note: may permanently delete untracked files",
        getDestructiveCommandWarning("git clean -fd").?,
    );
}

test "git clean dry-run is not destructive" {
    try std.testing.expect(getDestructiveCommandWarning("git clean -n") == null);
    try std.testing.expect(getDestructiveCommandWarning("git clean --dry-run") == null);
}

test "detects rm -rf" {
    const warning = getDestructiveCommandWarning("rm -rf /some/path");
    try std.testing.expect(warning != null);
    try std.testing.expectEqualStrings("Note: may recursively force-remove files", warning.?);
}

test "detects kubectl delete" {
    try std.testing.expectEqualStrings(
        "Note: may delete Kubernetes resources",
        getDestructiveCommandWarning("kubectl delete pod mypod").?,
    );
}

test "detects terraform destroy" {
    try std.testing.expectEqualStrings(
        "Note: may destroy Terraform infrastructure",
        getDestructiveCommandWarning("terraform destroy").?,
    );
}

test "detects SQL DROP" {
    try std.testing.expectEqualStrings(
        "Note: may drop or truncate database objects",
        getDestructiveCommandWarning("DROP TABLE users").?,
    );
    try std.testing.expectEqualStrings(
        "Note: may drop or truncate database objects",
        getDestructiveCommandWarning("drop database mydb").?,
    );
}

test "safe commands return null" {
    try std.testing.expect(getDestructiveCommandWarning("ls -la") == null);
    try std.testing.expect(getDestructiveCommandWarning("echo hello") == null);
    try std.testing.expect(getDestructiveCommandWarning("cat file.txt") == null);
}
