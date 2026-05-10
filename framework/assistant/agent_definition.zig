//! Agent Definition Types
//! Core types for defining and working with agents

const std = @import("std");
const ColorName = @import("agent_color_manager.zig").ColorName;

/// Source of an agent definition
pub const AgentSource = enum {
    user_settings,
    project_settings,
    local_settings,
    policy_settings,
    plugin,
    cli_args,
    builtin,
};

/// Permission mode for agent operation
pub const PermissionMode = enum {
    auto,
    accept_edits,
    dont_ask,
    bypass_permissions,
    bubble,
    plan,
};

/// Effort level for agent tasks
pub const EffortLevel = enum {
    minimal,
    low,
    medium,
    high,
    maximum,

    /// Parse effort level from string
    pub fn parse(s: []const u8) ?EffortLevel {
        const map = std.StaticStringMap(EffortLevel).initComptime(.{
            .{ "minimal", .minimal },
            .{ "low", .low },
            .{ "medium", .medium },
            .{ "high", .high },
            .{ "maximum", .maximum },
        });
        return map.get(s);
    }

    /// Parse from integer (1-5)
    pub fn fromInt(n: i32) ?EffortLevel {
        return switch (n) {
            1 => .minimal,
            2 => .low,
            3 => .medium,
            4 => .high,
            5 => .maximum,
            else => null,
        };
    }
};

/// Memory scope for agent persistence
pub const MemoryScope = enum {
    user,
    project,
    local,
};

/// Isolation mode for agent execution
pub const IsolationMode = enum {
    worktree,
    remote,
};

/// MCP server specification
pub const McpServerSpec = union(enum) {
    reference: []const u8,
    inline_def: struct { name: []const u8, config: []const u8 },
};

/// Function type for system prompt generation
pub const SystemPromptFn = *const fn (*anyopaque) []const u8;

/// Agent definition
pub const AgentDefinition = struct {
    /// Unique type identifier
    agent_type: []const u8,

    /// Description of when to use this agent
    when_to_use: []const u8,

    /// Allowed tools (null means all)
    tools: ?[][]const u8 = null,

    /// Disallowed tools
    disallowed_tools: ?[][]const u8 = null,

    /// Skills to preload
    skills: ?[][]const u8 = null,

    /// MCP servers for this agent
    mcp_servers: ?[]const McpServerSpec = null,

    /// Hooks configuration
    hooks: ?[]const u8 = null,

    /// Display color
    color: ?ColorName = null,

    /// Model to use (null = default, "inherit" = inherit from parent)
    model: ?[]const u8 = null,

    /// Effort level
    effort: ?EffortLevel = null,

    /// Permission mode
    permission_mode: ?PermissionMode = null,

    /// Maximum number of turns
    max_turns: ?u32 = null,

    /// Source filename
    filename: ?[]const u8 = null,

    /// Base directory
    base_dir: ?[]const u8 = null,

    /// Critical system reminder
    critical_reminder: ?[]const u8 = null,

    /// Required MCP server patterns
    required_mcp_servers: ?[][]const u8 = null,

    /// Run in background by default
    background: bool = false,

    /// Initial prompt to prepend
    initial_prompt: ?[]const u8 = null,

    /// Memory scope
    memory: ?MemoryScope = null,

    /// Isolation mode
    isolation: ?IsolationMode = null,

    /// Omit context docs (for read-only agents)
    omit_context_docs: bool = false,

    /// Source of the definition
    source: AgentSource,

    /// Plugin name (for plugin agents)
    plugin: ?[]const u8 = null,

    /// Pending snapshot update
    pending_snapshot_update: ?[]const u8 = null,

    /// System prompt function (for dynamic prompts)
    system_prompt_fn: ?SystemPromptFn = null,

    /// Check if this is a built-in agent
    pub fn isBuiltIn(self: AgentDefinition) bool {
        return self.source == .builtin;
    }

    /// Check if this is a plugin agent
    pub fn isPlugin(self: AgentDefinition) bool {
        return self.source == .plugin;
    }

    /// Check if this is a custom (user-defined) agent
    pub fn isCustom(self: AgentDefinition) bool {
        return self.source != .builtin and self.source != .plugin;
    }

    /// Check if agent has a specific tool
    pub fn hasTool(self: AgentDefinition, tool_name: []const u8) bool {
        // If no tools specified, has all
        if (self.tools == null) return true;

        // Check wildcard
        for (self.tools.?) |t| {
            if (std.mem.eql(u8, t, "*")) return true;
            if (std.mem.eql(u8, t, tool_name)) return true;
        }
        return false;
    }

    /// Check if tool is disallowed
    pub fn isToolDisallowed(self: AgentDefinition, tool_name: []const u8) bool {
        if (self.disallowed_tools) |disallowed| {
            for (disallowed) |t| {
                if (std.mem.eql(u8, t, tool_name)) return true;
            }
        }
        return false;
    }

    /// Get effective tools list
    pub fn getEffectiveTools(self: AgentDefinition, all_tools: []const []const u8, allocator: std.mem.Allocator) ![][]const u8 {
        // If wildcard, return all except disallowed
        if (self.tools == null or (self.tools.?.len == 1 and std.mem.eql(u8, self.tools.?[0], "*"))) {
            if (self.disallowed_tools == null) {
                const result = try allocator.alloc([]const u8, all_tools.len);
                @memcpy(result, all_tools);
                return result;
            }

            var result: std.ArrayList([]const u8) = .empty;
            for (all_tools) |t| {
                if (!self.isToolDisallowed(t)) {
                    try result.append(allocator, t);
                }
            }
            return result.toOwnedSlice(allocator);
        }

        // Return specified tools minus disallowed
        var result: std.ArrayList([]const u8) = .empty;
        for (self.tools.?) |t| {
            if (!self.isToolDisallowed(t)) {
                try result.append(allocator, t);
            }
        }
        return result.toOwnedSlice(allocator);
    }
};

// =============================================================================
// Tests
// =============================================================================

test "EffortLevel parse" {
    try std.testing.expectEqual(EffortLevel.medium, EffortLevel.parse("medium").?);
    try std.testing.expectEqual(EffortLevel.high, EffortLevel.parse("high").?);
    try std.testing.expectEqual(@as(?EffortLevel, null), EffortLevel.parse("invalid"));
}

test "EffortLevel fromInt" {
    try std.testing.expectEqual(EffortLevel.low, EffortLevel.fromInt(2).?);
    try std.testing.expectEqual(EffortLevel.maximum, EffortLevel.fromInt(5).?);
    try std.testing.expectEqual(@as(?EffortLevel, null), EffortLevel.fromInt(0));
    try std.testing.expectEqual(@as(?EffortLevel, null), EffortLevel.fromInt(10));
}

test "AgentDefinition isBuiltIn/isPlugin/isCustom" {
    const builtin = AgentDefinition{
        .agent_type = "test",
        .when_to_use = "test",
        .source = .builtin,
    };
    try std.testing.expect(builtin.isBuiltIn());
    try std.testing.expect(!builtin.isPlugin());
    try std.testing.expect(!builtin.isCustom());

    const plugin = AgentDefinition{
        .agent_type = "test",
        .when_to_use = "test",
        .source = .plugin,
    };
    try std.testing.expect(!plugin.isBuiltIn());
    try std.testing.expect(plugin.isPlugin());
    try std.testing.expect(!plugin.isCustom());

    const user = AgentDefinition{
        .agent_type = "test",
        .when_to_use = "test",
        .source = .user_settings,
    };
    try std.testing.expect(!user.isBuiltIn());
    try std.testing.expect(!user.isPlugin());
    try std.testing.expect(user.isCustom());
}

test "AgentDefinition hasTool" {
    const TOOLS_ARR = [_][]const u8{"*"};
    const tools_slice: [][]const u8 = @constCast(TOOLS_ARR[0..]);
    const all_tools_agent = AgentDefinition{
        .agent_type = "test",
        .when_to_use = "test",
        .source = .builtin,
        .tools = tools_slice,
    };
    try std.testing.expect(all_tools_agent.hasTool("Read"));
    try std.testing.expect(all_tools_agent.hasTool("Write"));

    const SPECIFIC_ARR = [_][]const u8{ "Read", "Grep" };
    const specific_slice: [][]const u8 = @constCast(SPECIFIC_ARR[0..]);
    const specific_tools_agent = AgentDefinition{
        .agent_type = "test",
        .when_to_use = "test",
        .source = .builtin,
        .tools = specific_slice,
    };
    try std.testing.expect(specific_tools_agent.hasTool("Read"));
    try std.testing.expect(!specific_tools_agent.hasTool("Write"));

    const no_tools_agent = AgentDefinition{
        .agent_type = "test",
        .when_to_use = "test",
        .source = .builtin,
    };
    try std.testing.expect(no_tools_agent.hasTool("Read"));
}

test "AgentDefinition isToolDisallowed" {
    const DISALLOWED_ARR = [_][]const u8{ "Bash", "Write" };
    const disallowed_slice: [][]const u8 = @constCast(DISALLOWED_ARR[0..]);
    const agent = AgentDefinition{
        .agent_type = "test",
        .when_to_use = "test",
        .source = .builtin,
        .disallowed_tools = disallowed_slice,
    };
    try std.testing.expect(agent.isToolDisallowed("Bash"));
    try std.testing.expect(agent.isToolDisallowed("Write"));
    try std.testing.expect(!agent.isToolDisallowed("Read"));
}
