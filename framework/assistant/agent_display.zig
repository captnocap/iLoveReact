//! Display utilities for agents
//! Provides consistent formatting and display logic

const std = @import("std");
const Allocator = std.mem.Allocator;

/// Source of an agent definition
pub const AgentSource = enum {
    user_settings,
    project_settings,
    local_settings,
    policy_settings,
    plugin,
    cli_args,
    builtin,

    /// Get display label for the source
    pub fn label(self: AgentSource) []const u8 {
        return switch (self) {
            .user_settings => "User agents",
            .project_settings => "Project agents",
            .local_settings => "Local agents",
            .policy_settings => "Managed agents",
            .plugin => "Plugin agents",
            .cli_args => "CLI arg agents",
            .builtin => "Built-in agents",
        };
    }

    /// Get lowercase name for override messages
    pub fn lowerName(self: AgentSource) []const u8 {
        return switch (self) {
            .user_settings => "user",
            .project_settings => "project",
            .local_settings => "local",
            .policy_settings => "managed",
            .plugin => "plugin",
            .cli_args => "cli arg",
            .builtin => "built-in",
        };
    }
};

/// Tool description configuration
pub const ToolDescription = struct {
    tools: ?[]const []const u8,
    disallowed_tools: ?[]const []const u8,

    /// Get a human-readable description of available tools
    pub fn getDescription(self: ToolDescription, allocator: Allocator) ![]const u8 {
        const has_allowlist = self.tools != null and self.tools.?.len > 0;
        const has_denylist = self.disallowed_tools != null and self.disallowed_tools.?.len > 0;

        if (has_allowlist and has_denylist) {
            // Both defined: filter allowlist by denylist
            var deny_set = std.StringHashMap(void).init(allocator);
            defer deny_set.deinit();
            for (self.disallowed_tools.?) |t| {
                try deny_set.put(t, {});
            }

            var count: usize = 0;
            for (self.tools.?) |t| {
                if (!deny_set.contains(t)) count += 1;
            }
            
            if (count == 0) {
                return try allocator.dupe(u8, "None");
            }
            
            var result = try allocator.alloc([]const u8, count);
            var i: usize = 0;
            for (self.tools.?) |t| {
                if (!deny_set.contains(t)) {
                    result[i] = t;
                    i += 1;
                }
            }
            defer allocator.free(result);
            return try std.mem.join(allocator, ", ", result);
        } else if (has_allowlist) {
            return try std.mem.join(allocator, ", ", self.tools.?);
        } else if (has_denylist) {
            const prefix = "All tools except ";
            const joined = try std.mem.join(allocator, ", ", self.disallowed_tools.?);
            defer allocator.free(joined);
            return try std.mem.concat(allocator, u8, &.{ prefix, joined });
        }

        return try allocator.dupe(u8, "All tools");
    }
};

/// Agent source groups in priority order
pub const SOURCE_GROUPS: []const AgentSource = &.{
    .user_settings,
    .project_settings,
    .local_settings,
    .policy_settings,
    .plugin,
    .cli_args,
    .builtin,
};

/// Entry for agent resolution
pub const AgentEntry = struct {
    agent_type: []const u8,
    source: AgentSource,
    overridden_by: ?AgentSource = null,

    /// Format an agent line for listings
    pub fn formatLine(
        self: AgentEntry,
        when_to_use: []const u8,
        tools_desc: []const u8,
        allocator: Allocator,
    ) ![]const u8 {
        return try std.fmt.allocPrint(
            allocator,
            "- {s}: {s} (Tools: {s})",
            .{ self.agent_type, when_to_use, tools_desc },
        );
    }
};

/// Compare agents by name (case-insensitive)
pub fn compareAgentsByName(a: []const u8, b: []const u8) bool {
    return std.ascii.lessThanIgnoreCase(a, b);
}

// =============================================================================
// Tests
// =============================================================================

test "AgentSource labels" {
    try std.testing.expectEqualStrings("User agents", AgentSource.user_settings.label());
    try std.testing.expectEqualStrings("Built-in agents", AgentSource.builtin.label());
}

test "ToolDescription - all tools" {
    const allocator = std.testing.allocator;
    const desc = ToolDescription{ .tools = null, .disallowed_tools = null };
    const result = try desc.getDescription(allocator);
    defer allocator.free(result);
    try std.testing.expectEqualStrings("All tools", result);
}

test "ToolDescription - allowlist only" {
    const allocator = std.testing.allocator;
    const tools = [_][]const u8{ "Read", "Write", "Grep" };
    const desc = ToolDescription{ .tools = tools[0..], .disallowed_tools = null };
    const result = try desc.getDescription(allocator);
    defer allocator.free(result);
    try std.testing.expectEqualStrings("Read, Write, Grep", result);
}

test "ToolDescription - denylist only" {
    const allocator = std.testing.allocator;
    const disallowed = [_][]const u8{"Bash"};
    const desc = ToolDescription{ .tools = null, .disallowed_tools = disallowed[0..] };
    const result = try desc.getDescription(allocator);
    defer allocator.free(result);
    try std.testing.expectEqualStrings("All tools except Bash", result);
}

test "ToolDescription - both lists" {
    const allocator = std.testing.allocator;
    const tools = [_][]const u8{ "Read", "Write", "Bash" };
    const disallowed = [_][]const u8{"Bash"};
    const desc = ToolDescription{ .tools = tools[0..], .disallowed_tools = disallowed[0..] };
    const result = try desc.getDescription(allocator);
    defer allocator.free(result);
    try std.testing.expectEqualStrings("Read, Write", result);
}

test "AgentEntry formatLine" {
    const allocator = std.testing.allocator;
    const entry = AgentEntry{
        .agent_type = "explorer",
        .source = .builtin,
    };
    const line = try entry.formatLine("Finds files", "Read, Grep", allocator);
    defer allocator.free(line);
    try std.testing.expectEqualStrings("- explorer: Finds files (Tools: Read, Grep)", line);
}

test "compareAgentsByName" {
    try std.testing.expect(compareAgentsByName("alpha", "beta"));
    try std.testing.expect(!compareAgentsByName("beta", "alpha"));
    try std.testing.expect(!compareAgentsByName("Alpha", "alpha")); // equal
}
