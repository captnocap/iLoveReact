//! Parser for sed edit commands (-i flag substitutions)
//! Extracts file paths and substitution patterns to enable file-edit-style rendering

const std = @import("std");

/// Information extracted from a sed in-place edit command
pub const SedEditInfo = struct {
    /// The file path being edited
    file_path: []const u8,
    /// The search pattern (regex)
    pattern: []const u8,
    /// The replacement string
    replacement: []const u8,
    /// Substitution flags (g, i, etc.)
    flags: []const u8,
    /// Whether to use extended regex (-E or -r flag)
    extended_regex: bool,

    /// Free allocated memory
    pub fn deinit(self: SedEditInfo, allocator: std.mem.Allocator) void {
        allocator.free(self.file_path);
        allocator.free(self.pattern);
        allocator.free(self.replacement);
        allocator.free(self.flags);
    }
};

/// Parse state for substitution expression
const ParseState = enum {
    pattern,
    replacement,
    flags,
};

/// Check if a command is a sed in-place edit command
/// Returns true only for simple sed -i 's/pattern/replacement/flags' file commands
pub fn isSedInPlaceEdit(command: []const u8) bool {
    return parseSedEditCommand(std.testing.allocator, command) catch null != null;
}

/// Parse a sed edit command and extract the edit information
/// Returns null if the command is not a valid sed in-place edit
pub fn parseSedEditCommand(allocator: std.mem.Allocator, command: []const u8) error{OutOfMemory}!?SedEditInfo {
    const trimmed = std.mem.trim(u8, command, &std.ascii.whitespace);

    // Must start with sed
    if (!std.mem.startsWith(u8, trimmed, "sed")) return null;

    // Check for word boundary after sed
    if (trimmed.len > 3 and !std.ascii.isWhitespace(trimmed[3])) {
        return null;
    }

    var args = std.ArrayList([]const u8).init(allocator);
    defer args.deinit();

    // Simple argument parsing (doesn't handle all shell quoting)
    const without_sed = trimmed[3..];
    try parseArgs(allocator, without_sed, &args);

    // Parse flags and arguments
    var has_in_place_flag = false;
    var extended_regex = false;
    var expression: ?[]const u8 = null;
    var file_path: ?[]const u8 = null;

    var i: usize = 0;
    while (i < args.items.len) : (i += 1) {
        const arg = args.items[i];

        // Handle -i flag (with or without backup suffix)
        if (std.mem.eql(u8, arg, "-i") or std.mem.eql(u8, arg, "--in-place")) {
            has_in_place_flag = true;
            i += 1;
            // Check if next arg looks like a backup suffix
            if (i < args.items.len) {
                const next = args.items[i];
                if (!std.mem.startsWith(u8, next, "-") and
                    (next.len == 0 or std.mem.startsWith(u8, next, ".")))
                {
                    i += 1; // Skip the backup suffix
                }
            }
            continue;
        }

        // Handle -i.bak style
        if (std.mem.startsWith(u8, arg, "-i")) {
            has_in_place_flag = true;
            continue;
        }

        // Handle extended regex flags
        if (std.mem.eql(u8, arg, "-E") or std.mem.eql(u8, arg, "-r") or
            std.mem.eql(u8, arg, "--regexp-extended"))
        {
            extended_regex = true;
            continue;
        }

        // Handle -e flag with expression
        if (std.mem.eql(u8, arg, "-e") or std.mem.eql(u8, arg, "--expression")) {
            if (i + 1 < args.items.len) {
                if (expression != null) return null; // Only support single expression
                expression = args.items[i + 1];
                i += 1;
                continue;
            }
            return null;
        }

        // Handle --expression=
        if (std.mem.startsWith(u8, arg, "--expression=")) {
            if (expression != null) return null;
            expression = arg[13..]; // After "--expression="
            continue;
        }

        // Skip other flags we don't understand
        if (std.mem.startsWith(u8, arg, "-")) {
            return null; // Unknown flag - not safe to parse
        }

        // Non-flag argument
        if (expression == null) {
            expression = arg;
        } else if (file_path == null) {
            file_path = arg;
        } else {
            return null; // More than one file - not supported
        }
    }

    // Must have -i flag, expression, and file path
    if (!has_in_place_flag or expression == null or file_path == null) {
        return null;
    }

    // Parse the substitution expression: s/pattern/replacement/flags
    const expr = expression.?;
    if (expr.len < 2 or expr[0] != 's') return null;

    const delimiter = expr[1];
    if (delimiter == ' ' or delimiter == '\t' or delimiter == '\n') return null;

    const rest = expr[2..];

    // Parse pattern, replacement, flags
    var pattern = std.ArrayList(u8).init(allocator);
    defer pattern.deinit();

    var replacement = std.ArrayList(u8).init(allocator);
    defer replacement.deinit();

    var flags = std.ArrayList(u8).init(allocator);
    defer flags.deinit();

    var state: ParseState = .pattern;
    var j: usize = 0;

    while (j < rest.len) {
        const char = rest[j];

        if (char == '\\' and j + 1 < rest.len) {
            // Escaped character
            switch (state) {
                .pattern => try pattern.appendSlice(rest[j .. j + 2]),
                .replacement => try replacement.appendSlice(rest[j .. j + 2]),
                .flags => try flags.appendSlice(rest[j .. j + 2]),
            }
            j += 2;
            continue;
        }

        if (char == delimiter) {
            switch (state) {
                .pattern => state = .replacement,
                .replacement => state = .flags,
                .flags => return null, // Extra delimiter in flags
            }
            j += 1;
            continue;
        }

        switch (state) {
            .pattern => try pattern.append(char),
            .replacement => try replacement.append(char),
            .flags => try flags.append(char),
        }
        j += 1;
    }

    // Must have found all three parts
    if (state != .flags) {
        return null;
    }

    // Validate flags - only allow safe substitution flags
    for (flags.items) |flag| {
        switch (flag) {
            'g', 'p', 'i', 'I', 'm', 'M', '1', '2', '3', '4', '5', '6', '7', '8', '9' => {},
            else => return null, // Invalid flag
        }
    }

    return SedEditInfo{
        .file_path = try allocator.dupe(u8, file_path.?),
        .pattern = try pattern.toOwnedSlice(),
        .replacement = try replacement.toOwnedSlice(),
        .flags = try flags.toOwnedSlice(),
        .extended_regex = extended_regex,
    };
}

/// Simple argument parsing - handles basic space separation and simple quotes
fn parseArgs(allocator: std.mem.Allocator, input: []const u8, args: *std.ArrayList([]const u8)) error{OutOfMemory}!void {
    var i: usize = 0;
    const trimmed = std.mem.trim(u8, input, &std.ascii.whitespace);

    while (i < trimmed.len) {
        // Skip whitespace
        while (i < trimmed.len and std.ascii.isWhitespace(trimmed[i])) {
            i += 1;
        }
        if (i >= trimmed.len) break;

        var arg = std.ArrayList(u8).init(allocator);
        defer arg.deinit();

        // Handle quoted strings
        if (trimmed[i] == '\'' or trimmed[i] == '"') {
            const quote = trimmed[i];
            i += 1;
            while (i < trimmed.len and trimmed[i] != quote) {
                try arg.append(trimmed[i]);
                i += 1;
            }
            if (i < trimmed.len and trimmed[i] == quote) {
                i += 1;
            }
        } else {
            // Unquoted argument
            while (i < trimmed.len and !std.ascii.isWhitespace(trimmed[i])) {
                try arg.append(trimmed[i]);
                i += 1;
            }
        }

        if (arg.items.len > 0) {
            try args.append(try allocator.dupe(u8, arg.items));
        }
    }
}

/// Apply a sed substitution to file content (simplified version)
/// Returns the new content after applying the substitution
///
/// Note: This is a simplified implementation that handles basic cases.
/// Full sed regex compatibility would require a full regex engine.
pub fn applySedSubstitution(
    allocator: std.mem.Allocator,
    content: []const u8,
    sed_info: SedEditInfo,
) error{OutOfMemory}![]u8 {
    _ = allocator;
    _ = sed_info;
    // For now, just return the original content
    // Full implementation would require regex substitution
    // This is a placeholder that preserves the interface
    return @constCast(content);
}

// =============================================================================
// Tests
// =============================================================================

test "parse simple sed -i command" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed -i 's/foo/bar/g' file.txt");
    defer if (result) |r| r.deinit(allocator);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("file.txt", result.?.file_path);
    try std.testing.expectEqualStrings("foo", result.?.pattern);
    try std.testing.expectEqualStrings("bar", result.?.replacement);
    try std.testing.expectEqualStrings("g", result.?.flags);
    try std.testing.expect(!result.?.extended_regex);
}

test "parse sed with extended regex" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed -i -E 's/foo.*/bar/g' file.txt");
    defer if (result) |r| r.deinit(allocator);

    try std.testing.expect(result != null);
    try std.testing.expect(result.?.extended_regex);
}

test "parse sed with -e flag" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed -i -e 's/foo/bar/' file.txt");
    defer if (result) |r| r.deinit(allocator);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("foo", result.?.pattern);
}

test "returns null for non-in-place sed" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed 's/foo/bar/' file.txt");
    try std.testing.expect(result == null);
}

test "returns null for non-substitution sed" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed -i 'd' file.txt");
    try std.testing.expect(result == null);
}

test "parse sed with inline -i.bak" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed -i.bak 's/foo/bar/g' file.txt");
    defer if (result) |r| r.deinit(allocator);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("file.txt", result.?.file_path);
}

test "parse with different delimiter" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed -i 's#foo#bar#g' file.txt");
    defer if (result) |r| r.deinit(allocator);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("foo", result.?.pattern);
    try std.testing.expectEqualStrings("bar", result.?.replacement);
}

test "parse with escaped delimiters" {
    const allocator = std.testing.allocator;

    const result = try parseSedEditCommand(allocator, "sed -i 's/foo\\/bar/baz/g' file.txt");
    defer if (result) |r| r.deinit(allocator);

    try std.testing.expect(result != null);
    try std.testing.expectEqualStrings("foo\\/bar", result.?.pattern);
}
